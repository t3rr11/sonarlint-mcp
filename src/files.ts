import path from "node:path";
import { readdir } from "node:fs/promises";

const LANG_BY_EXT: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".py": "python",
  ".pyi": "python",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  ".php": "php",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsp": "jsp",
  ".jspf": "jsp",
  ".tag": "jsp",
};

export function languageIdFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  const base = path.basename(file).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  return "plaintext";
}

export function isAnalyzable(file: string): boolean {
  return languageIdFor(file) !== "plaintext";
}

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn",
  "node_modules", "bower_components",
  "dist", "build", "out", "target", "bin", "obj",
  ".gradle", ".idea", ".vs", ".vscode",
  ".next", ".nuxt", ".angular", ".svelte-kit",
  "coverage", "vendor",
  "venv", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".tox", "site-packages",
  ".sonar", ".scannerwork", ".sonarlint", "sonarlint",
  ".terraform", "testdata",
]);

export interface CollectOptions {
  maxFiles?: number;
}

interface WalkOptions {
  max: number;
  extraSkips?: Set<string>;
  include?: (file: string) => boolean;
}

function isSkipped(name: string, extraSkips?: Set<string>): boolean {
  return SKIP_DIRS.has(name) || extraSkips?.has(name) === true;
}

async function walkDirectory(rootDir: string, opts: WalkOptions): Promise<string[]> {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0 && out.length < opts.max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; 
    }
    for (const e of entries) {
      if (out.length >= opts.max) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !isSkipped(e.name, opts.extraSkips)) {
        stack.push(full);
      } else if (e.isFile() && (!opts.include || opts.include(full))) {
        out.push(full);
      }
    }
  }
  return out;
}

export async function collectFiles(rootDir: string, opts: CollectOptions = {}): Promise<string[]> {
  const files = await walkDirectory(rootDir, { max: opts.maxFiles ?? 400, include: isAnalyzable });
  return files.sort((a, b) => a.localeCompare(b));
}

export async function listAllFiles(rootDir: string, cap = 20000): Promise<string[]> {
  return walkDirectory(rootDir, { max: cap, extraSkips: new Set([".sonarlint"]) });
}
