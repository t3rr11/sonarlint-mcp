import path from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { listAllFiles } from "../files.js";

export interface ServerRequestContext {
  root: string;
  cacheDir: string;
  getSettings(): Record<string, unknown>;
  isOpenInEditor(uri: string): boolean;
}

async function listFilesInFolderResponse(params: any): Promise<unknown> {
  const folderUri: string = params?.folderUri ?? "";
  const files = await listAllFiles(fileURLToPath(folderUri));
  const foundFiles = files.map((f) => ({ fileName: path.basename(f), filePath: f }));
  return { foundFiles };
}

function javaConfigResponse(params: any): unknown {
  const fileUri: string = typeof params === "string" ? params : params?.fileUri ?? "";
  const fileDir = path.dirname(fileURLToPath(fileUri));
  return {
    projectRoot: pathToFileURL(fileDir).href,
    sourceLevel: "17",
    classpath: [],
    isTest: false,
    vmLocation: process.env.JAVA_HOME ?? null,
  };
}

export function createServerRequestHandler(ctx: ServerRequestContext) {
  function configurationResponse(params: any): unknown[] {
    return (params?.items ?? []).map((item: any) => {
      const section: string = item?.section ?? "";
      if (!section) return ctx.getSettings();
      let value: any = ctx.getSettings();
      for (const part of section.split(".")) {
        if (value == null || typeof value !== "object") return null;
        value = value[part];
      }
      return value ?? {};
    });
  }

  return async (method: string, params: any): Promise<unknown> => {
    switch (method) {
      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
        return null;
      case "workspace/workspaceFolders":
        return [{ uri: pathToFileURL(ctx.root).href, name: path.basename(ctx.root) }];
      case "workspace/configuration":
        return configurationResponse(params);
      case "sonarlint/listFilesInFolder":
        return listFilesInFolderResponse(params);
      case "sonarlint/getJavaConfig":
        return javaConfigResponse(params);
      case "sonarlint/getOmnisharpLogDirectory": {
        const dir = path.join(ctx.cacheDir, "omnisharp-logs");
        await mkdir(dir, { recursive: true });
        return dir;
      }
      case "sonarlint/getTokenForServer":
      case "sonarlint/getCredentials":
        return process.env.SONAR_TOKEN ?? null;
      case "sonarlint/shouldAnalyseFile":
        return { shouldBeAnalysed: true };
      case "sonarlint/filterOutExcludedFiles":
        return { fileUris: params?.fileUris ?? [] };
      case "sonarlint/isOpenInEditor":
        return ctx.isOpenInEditor(String(params));
      case "sonarlint/isIgnoredByScm":
      case "sonarlint/hasJoinedIdeLabs":
      case "sonarlint/askSslCertificateConfirmation":
        return false;
      case "sonarlint/canShowMissingRequirementsNotification":
        return "never_again";
      case "sonarlint/getJavaHome":
        return process.env.JAVA_HOME ?? null;
      default:
        return null;
    }
  };
}
