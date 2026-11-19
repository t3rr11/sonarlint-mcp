import type { Issue } from "./types.js";

function lspSeverityToLabel(s?: number): string {
  switch (s) {
    case 1: return "ERROR";
    case 2: return "WARNING";
    case 3: return "INFO";
    case 4: return "HINT";
    default: return "INFO";
  }
}

export function normalizeDiagnostic(d: any): Issue {
  const code =
    typeof d.code === "object" && d.code !== null
      ? d.code
      : { value: d.code as string | undefined, target: undefined as string | undefined };
  const range = d.range ?? { start: {}, end: {} };
  return {
    rule: code.value ?? null,
    severity: lspSeverityToLabel(d.severity),
    message: d.message ?? "",
    line: (range.start?.line ?? 0) + 1,
    column: (range.start?.character ?? 0) + 1,
    endLine: (range.end?.line ?? range.start?.line ?? 0) + 1,
    endColumn: (range.end?.character ?? range.start?.character ?? 0) + 1,
    url: code.target ?? null,
  };
}
