# sonarlint-mcp

Run [SonarQube for IDE](https://www.sonarsource.com/products/sonarqube/ide/) (formerly SonarLint) static analysis locally on any file, folder, or project, exposed as a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server.

sonarlint-mcp bundles the **official SonarQube for IDE language server**, the exact engine that powers the VS Code extension, and serves its results as structured, deterministic JSON over MCP. No SonarQube server required. Analysis runs entirely on your machine.

## Why

- **The real engine, not a reimplementation.** Scans are executed by the unmodified `sonarlint-ls` language server and the same analyzer JARs SonarSource ships in the VS Code extension. Results match what the IDE extension shows.
- **Local and offline.** All analysis happens on your machine. SonarQube Server / SonarQube Cloud is only needed if you opt into [connected mode](#connected-mode-optional) to sync rule profiles.
- **Warm, persistent engine.** The language server is spawned once per session and kept alive, mirroring VS Code's behavior. The first scan pays JVM warmup; every scan after that is fast.
- **Structured output.** Compact JSON with rule key, severity, message, and exact line/column ranges: no markdown noise, no screenshots for a model to interpret.
- **Workspace-sandboxed by default.** Paths are resolved against the client's workspace root and scans cannot read outside it. See [Security](#security).
- **16+ languages.** Everything the VS Code extension ships with: JS/TS, Python, Java, C/C++, C#, Go, PHP, and more. See [Language support](#language-support).

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- [Java](https://adoptium.net) 17 or newer (tested with Java 21), on `PATH`
- Any MCP client: VS Code (Copilot agent mode), Claude Code, Claude Desktop, Cursor, Windsurf, OpenCode, Codex, or any other client that supports local stdio servers

## Install

Requires Node.js 20+ and Java 17+ on `PATH`. The first install downloads the SonarQube for IDE engine and all analyzers (~180 MB, one time); after that everything runs locally.

Run with npx (recommended):

```sh
npx -y sonarlint-mcp@latest
```

Or install globally:

```sh
npm install -g sonarlint-mcp
```

Either way, `npm` fetches the engine and analyzers automatically during install (a `postinstall` hook). You normally don't start the server yourself; your MCP client launches it from its configuration. See [Getting started](#getting-started).

Build from source instead:

```sh
git clone https://github.com/t3rr11/sonarlint-mcp
cd sonarlint-mcp
npm install        # also fetches the engine and analyzers
npm run build
```

## Getting started

Most MCP clients use a standard stdio configuration with npx:

```jsonc
{
  "mcpServers": {
    "sonarlint": {
      "command": "npx",
      "args": ["-y", "sonarlint-mcp@latest"]
    }
  }
}
```

On Windows, some clients need npx wrapped with `cmd /c`:

```jsonc
{
  "mcpServers": {
    "sonarlint": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "sonarlint-mcp@latest"]
    }
  }
}
```

<details>
<summary>VS Code</summary>

Follow the [MCP install guide](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server), or install via the CLI:

```bash
code --add-mcp '{"name":"sonarlint","command":"npx","args":["-y","sonarlint-mcp@latest"]}'
```

</details>

<details>
<summary>Claude Code</summary>

```bash
claude mcp add sonarlint -- npx -y sonarlint-mcp@latest
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the [MCP install guide](https://modelcontextprotocol.io/quickstart/user) and use the standard config above.

</details>

<details>
<summary>Cursor</summary>

Go to `Cursor Settings` → `MCP` → `Add new MCP Server`. Use `command` type with the command `npx` and the arguments `-y sonarlint-mcp@latest`.

</details>

<details>
<summary>OpenCode</summary>

```bash
opencode mcp add sonarlint --global -- npx -y sonarlint-mcp@latest
```

Or in `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "sonarlint": {
        "type": "local",
        "command": ["npx", "-y", "sonarlint-mcp@latest"]
      }
    }
  }
}
```

The server uses the OpenCode workspace directory as its workspace root, so scans are project-scoped automatically.

</details>

<details>
<summary>Run from a local build</summary>

If you built from source, point your client at the compiled server instead of npx:

```jsonc
{
  "mcpServers": {
    "sonarlint": {
      "command": "node",
      "args": ["/absolute/path/to/sonarlint-mcp/dist/index.js"]
    }
  }
}
```

</details>

## Tools

| Tool | Description |
|---|---|
| `sonarlint_scan_file` | Analyze a single file and return its issues. Parameters: `path` (string, required). |
| `sonarlint_scan_folder` | Analyze every analyzable file under a folder. Skips `node_modules`, build directories, `.git`, etc. Parameters: `folder` (string, optional; defaults to the workspace root), `maxFiles` (number, optional; default 400, max 5000). |
| `sonarlint_scan_project` | Analyze the whole workspace, equivalent to a folder scan from the root. Parameters: `maxFiles` (number, optional; default 1000, max 5000). |
| `sonarlint_list_rules` | List the analysis rules currently active for the workspace (standalone or connected mode). |
| `sonarlint_get_rule` | Get details for one rule: severity, type, description. Parameters: `ruleKey` (string, required, e.g. `typescript:S3923`). |
| `sonarlint_status` | Report engine state: whether the language server is running, the workspace root, and the cached analyzer version. |

Scan results are grouped by file with an issue summary by severity, plus a `timedOut` flag when the scan deadline (`SONARLINT_SCAN_TIMEOUT_MS`, default 180 s) was hit:

```json
{
  "file": "src/index.ts",
  "totalIssues": 1,
  "issues": [
    {
      "rule": "typescript:S3923",
      "severity": "MAJOR",
      "message": "Remove this pointless conditional.",
      "line": 12, "column": 3, "endLine": 12, "endColumn": 14,
      "url": "https://sonarsource.github.io/rspec/#/rspec/S3923"
    }
  ]
}
```

The typical agent workflow is: edit a file → `sonarlint_scan_file` → fix the reported issues → re-scan until clean. Use `sonarlint_scan_project` after larger refactors.

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `SONARLINT_CACHE_DIR` | `<install>/sonarlint` | Location of the extracted language server and analyzer cache |
| `SONARLINT_SCAN_TIMEOUT_MS` | `180000` | Overall scan deadline in milliseconds |
| `SONARLINT_COMPILE_COMMANDS` | - | Path to a `compile_commands.json` for C/C++ analysis |
| `SONARLINT_MCP_DEBUG` | - | Any value enables verbose LSP logging to stderr |
| `SONARLINT_ALLOW_ANY_PATH` | - | Any value lifts the workspace-root confinement (see [Security](#security)) |

## Connected mode (optional)

By default the server runs in **standalone mode**: SonarQube for IDE's recommended rule set for each language. To use your organization's quality profile instead, bind to SonarQube Server or SonarQube Cloud.

Via environment variables:

| Binding | Variables |
|---|---|
| SonarQube Server (self-hosted) | `SONARQUBE_URL` + `SONAR_PROJECT_KEY` |
| SonarQube Cloud | `SONARQUBE_ORG` + `SONAR_PROJECT_KEY` (optional `SONARCLOUD_REGION` = `EU` or `US`) |

Or via a workspace file, `.sonarlint/connectedMode.json` (the format the SonarQube for IDE VS Code extension uses):

```json
{
  "devopsBinding": { "connectionId": "my-conn", "projectKey": "org_my-project" },
  "serverUrl": "https://sonarqube.mycompany.com"
}
```

Authentication tokens are read from the `SONAR_TOKEN` environment variable and are never written to disk.

## Language support

All analyzers shipped with the SonarQube for IDE VS Code extension are included:

| Language | Notes |
|---|---|
| JavaScript / TypeScript | Syntax- and symbol-based in standalone mode (no type checker), identical to the VS Code extension standalone. Uses the bundled `eslint-bridge` and Node runtime. |
| Java | Includes symbolic execution analysis |
| Python, Go, PHP | - |
| C / C++ | Requires a compilation database (`SONARLINT_COMPILE_COMMANDS`) |
| C# | Analyzed via the bundled OmniSharp bridge |
| HTML, CSS, JSON, XML | - |
| Docker, Kubernetes, Terraform, CloudFormation, Azure Resource Manager | - |
| Text, Secrets | Detects weak credentials and secrets in any file type |

## Security

Paths passed to any tool are resolved against the MCP client's workspace root, and scans are confined to it: a scan cannot read arbitrary files elsewhere on the machine (such as credentials). `sonarlint_get_rule` and `sonarlint_list_rules` are read-only lookups.

sonarlint-mcp is a convenience boundary, not a security sandbox: set `SONARLINT_ALLOW_ANY_PATH=1` to lift confinement, and rely on your MCP client's own permissions for true access control. The bundled language server and analyzers are official SonarSource artifacts, extracted from the `sonarlint-vscode` distribution; the install step fetches them from SonarSource's GitHub releases.

## Known limitations

- JS/TS standalone analysis is syntax- and symbol-based, without a type checker; the same behavior as the VS Code extension in standalone mode. Connected mode does not change this.
- C/C++ requires a compilation database; there is no auto-discovery.
- Security hotspots are published by the language server on a separate channel (`sonarlint/publishSecurityHotspots`) and are not yet included in scan results.
- The first scan of a session includes JVM + analyzer warmup (~5-15 s). Subsequent scans in the same session are fast, as long as the MCP client keeps the server process alive.

## Development

```sh
npm install                  # also fetches the engine and analyzers (postinstall)
npm run build                # compile to dist/
npm run smoke                # engine-level: scans test-fixtures, prints JSON
node scripts/mcp-smoke.mjs   # full MCP protocol round-trip (spawns the server)
```

To update the bundled engine and analyzers, run `npm run setup -- --force`: it fetches the latest `sonarlint-vscode` release and refreshes the cache manifest (`sonarlint/manifest.json`).

## Release pipeline

GitHub Actions handle testing and publishing:

- **Tests** (`tests.yml`) runs on every pull request: installs dependencies (restoring the engine cache when available), builds, and runs both smoke tests.
- **Create Release** (`create-release.yml`) is triggered manually from the Actions tab with a version tag (e.g. `v1.0.0`) and optional notes. It creates the tag and a draft GitHub release, then dispatches publishing.
- **Publish** (`publish.yml`) runs on release dispatch, manual dispatch, or a manually pushed `v*` tag: it builds and publishes to npm, syncing `package.json` to the tag version.

Publishing authenticates with the `NPM_TOKEN` repository secret (a granular npm access token scoped to this package).

To publish a release by hand instead, run `npm publish` (the `files` whitelist keeps the ~180 MB engine cache out of the package; `npm pack --dry-run` shows what will ship).
