export const DEBUG = !!process.env.SONARLINT_MCP_DEBUG;

export function debugLog(message: string): void {
  if (DEBUG) console.error(`[sonarlint-mcp] ${message}`);
}
