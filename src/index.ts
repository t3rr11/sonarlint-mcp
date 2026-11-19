import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SonarLintEngine } from "./lsp/engine.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./config.js";

const engine = new SonarLintEngine();
const server = new McpServer({ name: "sonarlint-mcp", version: VERSION });
registerTools(server, engine);

async function shutdown() {
  await engine.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
console.error("[sonarlint-mcp] MCP server listening on stdio");
