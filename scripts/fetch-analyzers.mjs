#!/usr/bin/env node
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unzip } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = process.env.SONARLINT_CACHE_DIR ?? path.join(root, "sonarlint");
const force = process.argv.includes("--force");

const RELEASE_API =
  "https://api.github.com/repos/SonarSource/sonarlint-vscode/releases/latest";

  const PREFIXES = [
  "extension/server/",
  "extension/analyzers/",
  "extension/omnisharp/",
  "extension/eslint-bridge/",
];

function unzipAsync(data, opts) {
  return new Promise((resolve, reject) =>
    unzip(data, opts, (err, out) => (err ? reject(err) : resolve(out))),
  );
}

async function main() {
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(path.join(cache, "manifest.json"), "utf8"));
  } catch {
  }
  if (manifest && !force) {
    console.log(`Analyzers already cached (version ${manifest.version}).`);
    console.log(`Use "npm run setup -- --force" to re-download.`);
    return;
  }

  console.log("Fetching latest sonarlint-vscode release info…");
  const relRes = await fetch(RELEASE_API, {
    headers: { "User-Agent": "sonarlint-mcp", Accept: "application/vnd.github+json" },
  });
  if (!relRes.ok) throw new Error(`GitHub API request failed: HTTP ${relRes.status}`);
  const release = await relRes.json();

  const asset = release.assets?.find((a) => a.name.endsWith(".vsix"));
  if (!asset) throw new Error(`No .vsix asset found in release ${release.tag_name}`);

  console.log(`Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)…`);
  const vsixRes = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "sonarlint-mcp" },
  });
  if (!vsixRes.ok) throw new Error(`VSIX download failed: HTTP ${vsixRes.status}`);
  const zipBuf = Buffer.from(await vsixRes.arrayBuffer());

  console.log("Extracting server, analyzers and OmniSharp…");
  const entries = await unzipAsync(zipBuf, {
    filter: (f) => PREFIXES.some((p) => f.name.startsWith(p)),
  });

  if (force && existsSync(cache)) {
    await rm(cache, { recursive: true, force: true });
  }

  const fileEntries = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  const resolvedCache = path.resolve(cache);
  await Promise.all(
    fileEntries.map(async ([name, data]) => {
      const rel = name.replace(/^extension\//, "");
      const dest = path.resolve(resolvedCache, rel);
      if (dest !== resolvedCache && !dest.startsWith(resolvedCache + path.sep)) {
        throw new Error(`Archive entry escapes the cache directory, refusing to extract: ${name}`);
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(data));
    }),
  );
  const count = fileEntries.length;

  await mkdir(cache, { recursive: true });
  await writeFile(
    path.join(cache, "manifest.json"),
    JSON.stringify(
      {
        version: release.tag_name,
        asset: asset.name,
        extractedAt: new Date().toISOString(),
        files: count,
      },
      null,
      2,
    ),
  );

  console.log(`Done: extracted ${count} files into ${cache}`);
  const analyzersDir = path.join(cache, "analyzers");
  if (existsSync(analyzersDir)) {
    const jars = await readdir(analyzersDir);
    console.log(`Analyzers: ${jars.filter((f) => f.endsWith(".jar")).join(", ")}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(err.message ?? err);
  process.exit(1);
}
