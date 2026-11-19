import { spawn, type ChildProcess } from "node:child_process";
import { debugLog } from "../debug.js";

export type ServerRequestResponder = (method: string, params: unknown) => unknown;

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LspClient {
  private proc: ChildProcess | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers = new Map<string, (params: unknown) => void>();
  private responder: ServerRequestResponder = () => null;
  readonly stderrTail: string[] = [];
  private stderrRemainder = "";
  onExit?: (code: number | null) => void;

  start(command: string, args: string[], cwd: string): void {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;

    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (process.env.SONARLINT_MCP_DEBUG) {
        process.stderr.write(text);
      }
      this.pushStderrLines(text);
    });
    proc.on("exit", (code) => {
      if (this.stderrRemainder) {
        this.stderrTail.push(this.stderrRemainder);
        this.stderrRemainder = "";
      }
      for (const [, p] of this.pending) {
        p.reject(
          new Error(
            `sonarlint-ls exited unexpectedly (code ${code}).\n${this.stderrTail.slice(-15).join("")}`,
          ),
        );
      }
      this.pending.clear();
      this.onExit?.(code);
    });
  }

  get alive(): boolean {
    const proc = this.proc;
    if (!proc) return false;
    return proc.exitCode === null && proc.signalCode === null;
  }

  kill(): void {
    if (this.proc?.exitCode === null) {
      this.proc.kill();
    }
    this.proc = null;
  }

  onRequest(responder: ServerRequestResponder): void {
    this.responder = responder;
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  request(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error("LSP client not started"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: object): void {
    if (!this.proc?.stdin?.writable) return;
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.proc.stdin.write(Buffer.concat([header, body]));
  }

  private pushStderrLines(text: string): void {
    this.stderrRemainder += text;
    const lines = this.stderrRemainder.split("\n");
    this.stderrRemainder = lines.pop() ?? "";
    for (const line of lines) {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 100) this.stderrTail.shift();
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (this.buffer.length > MAX_BUFFER_BYTES) {
          this.protocolViolation("unterminated LSP header");
        }
        break;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (length > MAX_MESSAGE_BYTES) {
        this.protocolViolation(
          `declared message length ${length} exceeds the ${MAX_MESSAGE_BYTES} byte limit`,
        );
        break;
      }
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) break;
      const body = this.buffer.subarray(headerEnd + 4, total).toString("utf8");
      this.buffer = this.buffer.subarray(total);
      try {
        this.handleMessage(JSON.parse(body));
      } catch (err) {
        console.error(`[sonarlint-mcp] failed to handle LSP message: ${err}`);
      }
    }
  }

  private protocolViolation(reason: string): void {
    console.error(`[sonarlint-mcp] LSP protocol violation (${reason}) - killing language server.`);
    this.kill();
  }

  private handleMessage(msg: any): void {
    debugLog(`<< ${this.describeMessage(msg)}`);
    if (msg.method !== undefined) {
      this.handleIncomingMethod(msg);
      return;
    }
    this.handleResponse(msg);
  }

  private describeMessage(msg: any): string {
    if (msg.method === undefined) return `response to id ${msg.id}`;
    if (msg.id !== undefined) return `${msg.method} (id ${msg.id})`;
    return `${msg.method} (notification)`;
  }

  private handleIncomingMethod(msg: any): void {
    if (msg.id !== undefined) {
      this.respondToServerRequest(msg);
      return;
    }
    const handler = this.notificationHandlers.get(msg.method);
    if (handler) {
      handler(msg.params);
    } else {
      this.notificationHandlers.get("*")?.(msg);
    }
  }

  private respondToServerRequest(msg: any): void {
    Promise.resolve(this.safeRespond(msg.method, msg.params))
      .then((result) => this.send({ jsonrpc: "2.0", id: msg.id, result: result ?? null }))
      .catch((err) =>
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: String(err?.message ?? err) },
        }),
      );
  }

  private handleResponse(msg: any): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(`LSP error ${msg.error.code} for request: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async safeRespond(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.responder(method, params);
    } catch (err) {
      console.error(`[sonarlint-mcp] error responding to ${method}: ${err}`);
      return null;
    }
  }
}
