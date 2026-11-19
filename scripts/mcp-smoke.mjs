import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
});
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text);
  console.log(`\n== ${name} ==`);
  console.log(JSON.stringify(parsed, null, 1).slice(0, 1200));
}

await call("sonarlint_scan_file", { path: path.join(root, "test-fixtures", "sample.py") });
await call("sonarlint_scan_folder", { folder: path.join(root, "test-fixtures") });
await call("sonarlint_status", {});
await call("sonarlint_get_rule", { ruleKey: "python:S2068" });

await client.close();
