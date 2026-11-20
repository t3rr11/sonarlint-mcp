import path from "node:path";
import type { FileResult, Issue, ScanResult } from "./types.js";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { LspClient } from "./jsonrpc.js";
import { normalizeDiagnostic } from "./diagnostics.js";
import { contains, commonRoot } from "./paths.js";
import { createServerRequestHandler } from "./serverRequests.js";
import { buildInitOptions, buildWorkspaceSettings } from "./startup.js";
import { DEBUG, debugLog } from "../debug.js";
import { languageIdFor } from "../files.js";
import {
  DEFAULT_SCAN_TIMEOUT_MS,
  PROJECT_ROOT,
  VERSION,
  readCacheManifest,
  resolveCacheDir,
  resolveConnectedMode,
} from "../config.js";

export type { Issue, FileResult, ScanResult } from "./types.js";

const PER_FILE_TIMEOUT_MS = 60000;
const SETTLE_MS = 800;
const ANALYZE_BATCH_SIZE = 50;

export class SonarLintEngine {
  private client?: LspClient;
  private root?: string;
  private startPromise?: Promise<void>;
  private settings: Record<string, unknown> = {};
  private readonly diagnostics = new Map<string, Issue[]>();
  private readonly lastPublishAt = new Map<string, number>();
  private readonly openUris = new Set<string>();
  private pendingProgress = 0;
  private lastEngineActivityAt = 0;
  private readonly activityWaiters: (() => void)[] = [];

  get isRunning(): boolean {
    return this.client?.alive ?? false;
  }

  get workspaceRoot(): string | undefined {
    return this.root;
  }

  private startChain: Promise<void> = Promise.resolve();

  async ensureStarted(root: string): Promise<void> {
    const run = this.startChain.then(() => this.doEnsureStarted(root));
    this.startChain = run.catch(() => {});
    await run;
  }

  private async doEnsureStarted(root: string): Promise<void> {
    if (this.client && this.root && (this.root === root || contains(this.root, root))) {
      await this.startPromise;
      return;
    }
    await this.stop();
    this.root = root;
    this.startPromise = this.start(root).catch((err) => {
      this.startPromise = undefined;
      throw err;
    });
    await this.startPromise;
  }

  stop(): Promise<void> {
    if (this.client) {
      this.client.kill();
      this.client = undefined;
    }
    this.diagnostics.clear();
    this.lastPublishAt.clear();
    this.openUris.clear();
    this.pendingProgress = 0;
    this.lastEngineActivityAt = 0;
    this.wakeActivityWaiters();
    this.startPromise = undefined;
    return Promise.resolve();
  }

  private wakeActivityWaiters(): void {
    for (const wake of this.activityWaiters.splice(0)) {
      wake();
    }
  }

  private async start(root: string): Promise<void> {
    const cacheDir = resolveCacheDir();
    const lsJar = path.join(cacheDir, "server", "sonarlint-ls.jar");
    if (!existsSync(lsJar)) {
      throw new Error(
        `SonarLint language server not found at ${lsJar}.\n` +
          `Run "npm run setup" in ${PROJECT_ROOT} to download the analyzers.`,
      );
    }
    const analyzersDir = path.join(cacheDir, "analyzers");
    let analyzerJars: string[] = [];
    try {
      analyzerJars = (await readdir(analyzersDir))
        .filter((f) => f.endsWith(".jar"))
        .map((f) => path.join(analyzersDir, f));
    } catch {
      analyzerJars = [];
    }

    const client = new LspClient();
    this.client = client;
    client.start("java", ["-Xss4m", "-jar", lsJar, "-stdio", "-analyzers", ...analyzerJars], root);

    client.onNotification("textDocument/publishDiagnostics", (params: any) => {
      const uri: string = params.uri;
      const diags = (params.diagnostics ?? []).map(normalizeDiagnostic);
      debugLog(`publish ${uri.split("/").pop()}: ${diags.length} issue(s)`);
      this.diagnostics.set(uri, diags);
      this.lastPublishAt.set(uri, Date.now());
      this.markEngineActivity();
    });

    client.onNotification("$/progress", (params: any) => {
      const kind = params?.value?.kind;
      if (kind === "begin") this.pendingProgress++;
      else if (kind === "end") this.pendingProgress = Math.max(0, this.pendingProgress - 1);
      this.markEngineActivity();
      debugLog(`progress ${kind} (pending=${this.pendingProgress})`);
    });

    if (DEBUG) {
      client.onNotification("*", (msg: any) => {
        if (msg.method === "textDocument/publishDiagnostics") return;
        debugLog(`<< ${msg.method} ${JSON.stringify(msg.params ?? {}).slice(0, 500)}`);
      });
      const originalOnExit = client.onExit;
      client.onExit = (code) => {
        debugLog(`LS exited with code ${code}`);
        originalOnExit?.(code);
      };
    }

    client.onRequest(
      createServerRequestHandler({
        root,
        cacheDir,
        getSettings: () => this.settings,
        isOpenInEditor: (uri) => this.openUris.has(uri),
      }),
    );

    const cm = await resolveConnectedMode(root);
    const initOptions = buildInitOptions(root, cacheDir, cm);

    const rootUri = pathToFileURL(root).href;
    await client.request(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
        capabilities: {
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
              codeDescriptionSupport: true,
              dataSupport: true,
            },
            synchronization: {
              dynamicRegistration: true,
              didSave: true,
            },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: true },
          },
        },
        initializationOptions: initOptions,
        clientInfo: { name: "sonarlint-mcp", version: VERSION },
        locale: "en",
      },
      120000,
    );
    client.notify("initialized", {});

    this.settings = buildWorkspaceSettings(cacheDir, cm);
    client.notify("workspace/didChangeConfiguration", this.settings);
  }

  private markEngineActivity(): void {
    this.lastEngineActivityAt = Date.now();
    this.wakeActivityWaiters();
  }

  private waitForDiagnostics(
    opened: { uri: string; time: number }[],
    done: Set<string>,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        const index = this.activityWaiters.indexOf(wake);
        if (index >= 0) this.activityWaiters.splice(index, 1);
        resolve();
      };
      const check = (): boolean => {
        if (signal?.aborted) return true;
        const now = Date.now();
        if (now > deadline) return true;
        const engineQuiet =
          this.pendingProgress === 0 && now - this.lastEngineActivityAt >= SETTLE_MS;
        for (const o of opened) {
          if (done.has(o.uri)) continue;
          const last = this.lastPublishAt.get(o.uri) ?? 0;
          if ((engineQuiet && last >= o.time) || now - o.time >= PER_FILE_TIMEOUT_MS) {
            done.add(o.uri);
          }
        }
        return done.size >= opened.length;
      };
      const wake = (): void => {
        if (check()) finish();
      };
      const timer = setInterval(wake, 250);
      if (check()) {
        finish();
      } else {
        this.activityWaiters.push(wake);
      }
    });
  }

  async analyze(
    paths: string[],
    timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<ScanResult> {
    if (paths.length === 0) {
      return { root: "", files: [], totalIssues: 0, timedOut: false };
    }
    const root = commonRoot(paths.map((p) => path.dirname(path.resolve(p))));
    await this.ensureStarted(root);
    const client = this.client!;

    const deadline = Date.now() + timeoutMs;
    const results = new Map<string, FileResult>();
    const done = new Set<string>();
    let totalOpened = 0;

    for (let i = 0; i < paths.length; i += ANALYZE_BATCH_SIZE) {
      if (signal?.aborted) break;
      // eslint-disable-next-line sonarjs/no-await-in-loop -- sequential batches are intentional: they bound memory and limit load on the SonarLint LSP server
      totalOpened += await this.processBatch(
        paths.slice(i, i + ANALYZE_BATCH_SIZE),
        client,
        root,
        results,
        done,
        deadline,
        signal,
      );
    }

    const files = paths.map((p) => {
      const abs = path.resolve(p);
      return results.get(pathToFileURL(abs).href) ?? { file: path.relative(root, abs), issues: [] };
    });

    const totalIssues = files.reduce((n, f) => n + f.issues.length, 0);
    return { root, files, totalIssues, timedOut: done.size < totalOpened };
  }

  private async processBatch(
    batch: string[],
    client: LspClient,
    root: string,
    results: Map<string, FileResult>,
    done: Set<string>,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<number> {
    const entries = await Promise.all(
      batch.map(async (p) => {
        const abs = path.resolve(p);
        const uri = pathToFileURL(abs).href;
        try {
          const text = await readFile(abs, "utf8");
          return { abs, uri, text, lang: languageIdFor(abs) };
        } catch (e: any) {
          return { abs, uri, text: null, lang: "plaintext", error: e?.message ?? String(e) };
        }
      }),
    );

    const opened: { uri: string; time: number }[] = [];
    for (const e of entries) {
      if (e.text === null) {
        results.set(e.uri, { file: path.relative(root, e.abs), issues: [], error: e.error });
        continue;
      }
      this.diagnostics.delete(e.uri);
      this.openUris.add(e.uri);
      client.notify("textDocument/didOpen", {
        textDocument: { uri: e.uri, languageId: e.lang, version: 1, text: e.text },
      });
      opened.push({ uri: e.uri, time: Date.now() });
    }

    if (opened.length > 0) {
      // eslint-disable-next-line sonarjs/no-await-in-loop -- sequential batches are intentional: they bound memory and limit load on the SonarLint LSP server
      await this.waitForDiagnostics(opened, done, deadline, signal);
    }

    for (const e of entries) {
      if (e.text === null) continue;
      this.openUris.delete(e.uri);
      client.notify("textDocument/didClose", { textDocument: { uri: e.uri } });
      results.set(e.uri, {
        file: path.relative(root, e.abs),
        issues: this.diagnostics.get(e.uri) ?? [],
      });
    }
    return opened.length;
  }

  async listRules(): Promise<unknown> {
    await this.ensureStarted(process.cwd());
    try {
      return await this.client!.request("sonarlint/listAllRules", undefined, 30000);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  }

  async getRule(ruleKey: string): Promise<unknown> {
    const rules = await this.listRules();
    if (rules && typeof rules === "object" && !("error" in rules)) {
      for (const [language, langRules] of Object.entries(rules as Record<string, any[]>)) {
        const found = (langRules as any[]).find((r) => r.key === ruleKey);
        if (found) return { language, ...found };
      }
    }
    return { error: `Rule not found: ${ruleKey}` };
  }

  async status(): Promise<Record<string, unknown>> {
    return {
      running: this.isRunning,
      workspaceRoot: this.root ?? null,
      analyzers: await readCacheManifest(),
    };
  }
}
