import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SonarLintEngine } from "./lsp/engine.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./config.js";

const engine = new SonarLintEngine();
const server = new McpServer({ name: "sonarlint-mcp", version: VERSION });
registerTools(server, engine);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await engine.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err?.code === "EPIPE" || err?.code === "EOF") process.exit(0);
});

process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
console.error("[sonarlint-mcp] MCP server listening on stdio");
