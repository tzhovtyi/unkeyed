/** Tool calls out of a CLI with no tool-use flag: `--json-schema` for a forced tool, an
 * MCP bridge otherwise, whose placeholder reply the decoder stops short of reaching. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolIntent, ToolSpec } from "../../ir/index.js";

/** The MCP server name, and so the prefix the CLI puts on every bridged tool. */
export const BRIDGE_SERVER = "unkeyed";
const BRIDGE_PREFIX = `mcp__${BRIDGE_SERVER}__`;

/** Embedded as a string so no bundler or packaging step can drop it. */
const BRIDGE_SOURCE = `import { readFileSync } from "node:fs";

const tools = JSON.parse(readFileSync(process.argv[2], "utf8"));

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    // Notifications carry no id and expect no response.
    if (request.id === undefined) continue;
    switch (request.method) {
      case "initialize":
        reply(request.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "unkeyed", version: "1" },
        });
        break;
      case "tools/list":
        reply(request.id, { tools });
        break;
      case "tools/call":
        // Never reaches the model: the caller stops reading at the tool-use turn.
        reply(request.id, {
          content: [{ type: "text", text: "This tool is executed by the caller." }],
        });
        break;
      default:
        reply(request.id, {});
    }
  }
});
`;

/** The route taken, carried encoder → decoder so the caller gets its own names back. */
export type ToolPlan =
  | { kind: "none" }
  | { kind: "schema"; toolName: string }
  /** Bridged tools, keyed by the prefixed name the CLI will report. */
  | { kind: "bridge"; originalNames: Map<string, string> };

/** The mechanism this CLI will use for the caller's stated intent. */
export function planFor(intent: ToolIntent): ToolPlan {
  if (intent.kind === "none") return { kind: "none" };
  if (intent.kind === "forced") return { kind: "schema", toolName: intent.tool.name };

  const originalNames = new Map<string, string>();
  for (const tool of intent.tools) originalNames.set(BRIDGE_PREFIX + tool.name, tool.name);
  return { kind: "bridge", originalNames };
}

/** `--allowedTools` is scoped to the bridged names; without it the CLI prompts and hangs. */
export async function writeBridge(dir: string, tools: readonly ToolSpec[]): Promise<string[]> {
  const scriptPath = path.join(dir, "unkeyed-mcp-bridge.mjs");
  const toolsPath = path.join(dir, "unkeyed-tools.json");
  const configPath = path.join(dir, "unkeyed-mcp.json");

  const manifest = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
  }));
  const config = {
    mcpServers: {
      [BRIDGE_SERVER]: { command: process.execPath, args: [scriptPath, toolsPath] },
    },
  };

  await Promise.all([
    writeFile(scriptPath, BRIDGE_SOURCE, "utf8"),
    writeFile(toolsPath, JSON.stringify(manifest), "utf8"),
    writeFile(configPath, JSON.stringify(config), "utf8"),
  ]);

  return [
    "--mcp-config",
    configPath,
    "--allowedTools",
    tools.map((tool) => BRIDGE_PREFIX + tool.name).join(","),
  ];
}

/** `--json-schema` is a forced tool call, so the stream carries real argument deltas. */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** The caller's name for a tool the CLI reported under one of its own. */
export function originalToolName(name: string, plan: ToolPlan): string {
  if (plan.kind === "schema") {
    return name === STRUCTURED_OUTPUT_TOOL ? plan.toolName : name;
  }
  if (plan.kind === "bridge") {
    const original = plan.originalNames.get(name);
    if (original !== undefined) return original;
  }
  return name.startsWith(BRIDGE_PREFIX) ? name.slice(BRIDGE_PREFIX.length) : name;
}
