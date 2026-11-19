import path from "node:path";
import { existsSync } from "node:fs";
import {
  VERSION,
  connectedModeSettings,
  connectedModeConnections,
  type ConnectedModeConfig,
} from "../config.js";

export function buildInitOptions(
  root: string,
  cacheDir: string,
  cm: ConnectedModeConfig | undefined,
): Record<string, unknown> {
  const initOptions: Record<string, unknown> = {
    productKey: "vscode",
    productName: "sonarlint-mcp",
    productVersion: VERSION,
    telemetryStorage: path.join(cacheDir, "telemetry"),
    showVerboseLogs: !!process.env.SONARLINT_MCP_DEBUG,
    platform: `${process.platform}-${process.arch}`,
    architecture: process.arch,
    enableNotebooks: false,
    workspaceName: path.basename(root),
    firstSecretDetected: false,
    clientNodePath: process.execPath,
    connections: cm ? connectedModeConnections(cm) : { sonarqube: [], sonarcloud: [] },
    rules: {},
    focusOnNewCode: false,
    automaticAnalysis: true,
  };
  const eslintBridge = path.join(cacheDir, "eslint-bridge");
  if (existsSync(eslintBridge)) initOptions.eslintBridgeServerPath = eslintBridge;
  return initOptions;
}

export function buildWorkspaceSettings(
  cacheDir: string,
  cm: ConnectedModeConfig | undefined,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    rules: {},
    automaticAnalysis: true,
    focusOnNewCode: false,
    showVerboseLogs: false,
    pathToNodeExecutable: process.execPath,
  };
  const eslintBridge = path.join(cacheDir, "eslint-bridge");
  if (existsSync(eslintBridge)) settings.eslintBridgeServerPath = eslintBridge;
  if (process.env.SONARLINT_COMPILE_COMMANDS) {
    settings.pathToCompileCommands = process.env.SONARLINT_COMPILE_COMMANDS;
  }
  if (cm) settings.connectedMode = connectedModeSettings(cm);
  return { sonarlint: settings };
}
