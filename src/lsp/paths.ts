import path from "node:path";

export function contains(dir: string, maybeChild: string): boolean {
  return maybeChild === dir || maybeChild.startsWith(dir + path.sep);
}

export function commonRoot(dirs: string[]): string {
  if (dirs.length === 1) return dirs[0];
  let root = dirs[0];
  while (!dirs.every((d) => d === root || d.startsWith(root + path.sep))) {
    const up = path.dirname(root);
    if (up === root) return root;
    root = up;
  }
  return root;
}
