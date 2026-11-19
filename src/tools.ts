import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SonarLintEngine, type ScanResult } from "./lsp/engine.js";
import { DEFAULT_SCAN_TIMEOUT_MS } from "./config.js";
import { collectFiles } from "./files.js";

const DEFAULT_MAX_FOLDER_FILES = 400;
const DEFAULT_MAX_PROJECT_FILES = 1000;

function isWithin(child: string, dir: string): boolean {
  if (child === dir) return true;
  if (process.platform !== "win32") return child.startsWith(dir + path.sep);
  const c = child.toLowerCase();
  const d = dir.toLowerCase();
  return c.startsWith(d + path.sep);
}

function resolveWorkspacePath(p: string, kind: "file" | "folder"): string {
  const root = path.resolve(process.cwd());
  const abs = path.resolve(p);
  if (!isWithin(abs, root) && !process.env.SONARLINT_ALLOW_ANY_PATH) {
    throw new Error(
      `${kind} "${p}" is outside the workspace root (${root}). ` +
        `Set SONARLINT_ALLOW_ANY_PATH=1 to scan paths outside the workspace.`,
    );
  }
  return abs;
}

function textResponse(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function summarizeScan(result: ScanResult, target: string) {
  const all = result.files.flatMap((f) => f.issues);
  const bySeverity: Record<string, number> = {};
  for (const i of all) {
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }
  const filesWithIssues = result.files.filter((f) => f.issues.length > 0 || f.error);
  return {
    target,
    filesScanned: result.files.length,
    cleanFiles: result.files.length - result.files.filter((f) => f.issues.length > 0).length,
    totalIssues: all.length,
    bySeverity,
    timedOut: result.timedOut,
    files: filesWithIssues.map((f) => ({ file: f.file, issues: f.issues, error: f.error })),
  };
}

export function registerTools(server: McpServer, engine: SonarLintEngine): void {
  server.registerTool(
    "sonarlint_scan_file",
    {
      title: "SonarLint: scan file",
      description:
        "Run a local SonarLint (SonarQube for IDE engine) analysis on a single file and " +
        "return code-quality, bug and security issues as JSON. Use after editing a file.",
      inputSchema: {
        path: z.string().describe("File to analyze (absolute or relative to the workspace root)"),
      },
    },
    async ({ path: p }) => {
      const abs = resolveWorkspacePath(p, "file");
      const result = await engine.analyze([abs], DEFAULT_SCAN_TIMEOUT_MS);
      const f = result.files[0];
      return textResponse({
        file: f?.file,
        totalIssues: f?.issues.length ?? 0,
        issues: f?.issues ?? [],
        error: f?.error,
        timedOut: result.timedOut,
      });
    },
  );

  server.registerTool(
    "sonarlint_scan_folder",
    {
      title: "SonarLint: scan folder",
      description:
        "Run a local SonarLint analysis on every analyzable file under a folder " +
        "(skips node_modules, build dirs, .git, etc.). Returns issues grouped by file.",
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe("Folder to scan (default: current workspace root)"),
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Maximum number of files to scan (default 400)"),
      },
    },
    async ({ folder, maxFiles }) => {
      const dir = resolveWorkspacePath(folder ?? process.cwd(), "folder");
      const files = await collectFiles(dir, { maxFiles: maxFiles ?? DEFAULT_MAX_FOLDER_FILES });
      if (files.length === 0) {
        return textResponse({ target: dir, filesScanned: 0, note: "No analyzable files found" });
      }
      const result = await engine.analyze(files, DEFAULT_SCAN_TIMEOUT_MS);
      return textResponse(summarizeScan(result, dir));
    },
  );

  server.registerTool(
    "sonarlint_scan_project",
    {
      title: "SonarLint: scan project",
      description:
        "Run a local SonarLint analysis over the entire current workspace/project " +
        "(equivalent to a full folder scan from the workspace root).",
      inputSchema: {
        maxFiles: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Maximum number of files to scan (default 1000)"),
      },
    },
    async ({ maxFiles }) => {
      const root = path.resolve(process.cwd());
      const files = await collectFiles(root, { maxFiles: maxFiles ?? DEFAULT_MAX_PROJECT_FILES });
      if (files.length === 0) {
        return textResponse({ target: root, filesScanned: 0, note: "No analyzable files found" });
      }
      const result = await engine.analyze(files, DEFAULT_SCAN_TIMEOUT_MS);
      return textResponse(summarizeScan(result, root));
    },
  );

  server.registerTool(
    "sonarlint_list_rules",
    {
      title: "SonarLint: list rules",
      description: "List the SonarLint rules currently active for the workspace.",
      inputSchema: {},
    },
    async () => textResponse(await engine.listRules()),
  );

  server.registerTool(
    "sonarlint_get_rule",
    {
      title: "SonarLint: rule details",
      description:
        "Get details (severity, type, description) for a SonarLint rule key, e.g. 'typescript:S3923'.",
      inputSchema: {
        ruleKey: z.string().describe("Rule key, e.g. typescript:S3923"),
      },
    },
    async ({ ruleKey }) => textResponse(await engine.getRule(ruleKey)),
  );

  server.registerTool(
    "sonarlint_status",
    {
      title: "SonarLint: status",
      description:
        "Report the state of the SonarLint engine: whether it is running, the workspace root, " +
        "and the cached analyzer version.",
      inputSchema: {},
    },
    async () => textResponse(await engine.status()),
  );
}
