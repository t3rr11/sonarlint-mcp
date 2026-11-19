import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..");

export const VERSION = "1.0.0";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : fallback;
}

export const DEFAULT_SCAN_TIMEOUT_MS = parsePositiveInt(
  process.env.SONARLINT_SCAN_TIMEOUT_MS,
  180000,
);

export function resolveCacheDir(): string {
  return process.env.SONARLINT_CACHE_DIR ?? path.join(PROJECT_ROOT, "sonarlint");
}

export interface CacheManifest {
  version: string;
  asset: string;
  extractedAt: string;
  files: number;
}

export async function readCacheManifest(): Promise<CacheManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(resolveCacheDir(), "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

export interface ConnectedModeConfig {
  kind: "sonarqube" | "sonarcloud";
  connectionId: string;
  serverUrl?: string;
  organizationKey?: string;
  region?: string;
  projectKey: string;
  token?: string;
}

export async function resolveConnectedMode(
  workspaceRoot: string,
): Promise<ConnectedModeConfig | undefined> {
  const token = process.env.SONAR_TOKEN;
  const serverUrl = process.env.SONARQUBE_URL;
  const org = process.env.SONARQUBE_ORG;
  const region = process.env.SONARCLOUD_REGION?.toUpperCase() === "US" ? "US" : "EU";
  const projectKey = process.env.SONAR_PROJECT_KEY;

  if (serverUrl && projectKey) {
    return { kind: "sonarqube", connectionId: "mcp", serverUrl, projectKey, token };
  }
  if (org && projectKey) {
    return { kind: "sonarcloud", connectionId: "mcp", organizationKey: org, region, projectKey, token };
  }

  try {
    const file = path.join(workspaceRoot, ".sonarlint", "connectedMode.json");
    if (existsSync(file)) {
      const raw = JSON.parse(await readFile(file, "utf8"));
      const binding = raw.devopsBinding ?? raw;
      const key = binding.projectKey ?? raw.projectKey;
      if (key) {
        const kind: "sonarqube" | "sonarcloud" =
          raw.serverUrl || serverUrl ? "sonarqube" : "sonarcloud";
        return {
          kind,
          connectionId: binding.connectionId ?? raw.connectionId ?? "mcp",
          serverUrl: raw.serverUrl ?? serverUrl,
          organizationKey: raw.organizationKey ?? org,
          region: raw.region?.toUpperCase() === "US" ? "US" : region,
          projectKey: key,
          token,
        };
      }
    }
  } catch {
  }
  return undefined;
}

export function connectedModeSettings(cm: ConnectedModeConfig): unknown {
  return {
    connections: connectedModeConnections(cm),
    project: { connectionId: cm.connectionId, projectKey: cm.projectKey },
  };
}

export function connectedModeConnections(cm: ConnectedModeConfig): unknown {
  if (cm.kind === "sonarqube") {
    return {
      sonarqube: [{ connectionId: cm.connectionId, serverUrl: cm.serverUrl }],
      sonarcloud: [],
    };
  }
  return {
    sonarqube: [],
    sonarcloud: [
      {
        connectionId: cm.connectionId,
        region: cm.region ?? "EU",
        organizationKey: cm.organizationKey,
      },
    ],
  };
}
