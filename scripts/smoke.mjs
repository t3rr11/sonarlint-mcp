import path from "node:path";
import { fileURLToPath } from "node:url";
import { SonarLintEngine } from "../dist/lsp/engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = new SonarLintEngine();

try {
  const files = [
    path.join(root, "test-fixtures", "sample.ts"),
    path.join(root, "test-fixtures", "sample.py"),
  ];
  console.error(`Analyzing ${files.length} fixture files…`);
  const res = await engine.analyze(files);
  console.log(JSON.stringify(res, null, 2));
} finally {
  await engine.stop();
}
