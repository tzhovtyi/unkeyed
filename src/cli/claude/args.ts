import type { Effort } from "../../ir/index.js";

/** Nothing of the host configuration should reach a call standing in for a request. */
const SEALED = [
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--setting-sources",
  "",
] as const;

export type StreamArgs = {
  model: string;
  systemPrompt: string;
  effort?: Effort | undefined;
};

/** `--tools ""`: the only tools a caller gets are the ones bridged in explicitly. */
export function streamArgs(options: StreamArgs): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--input-format",
    "stream-json",
    ...SEALED,
    "--tools",
    "",
    "--model",
    options.model,
    "--system-prompt",
    options.systemPrompt,
  ];
  if (options.effort !== undefined) args.push("--effort", options.effort);
  return args;
}

export type CompletionFlags = {
  tools: readonly string[];
  model?: string | undefined;
  effort?: Effort | undefined;
  systemPrompt?: string | undefined;
};

/** An empty `--tools` shrinks the harness prompt, making overhead subtraction near-exact. */
export function completionArgs(options: CompletionFlags): string[] {
  const args = ["-p", "--output-format", "json", "--tools", options.tools.join(","), ...SEALED];
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.effort !== undefined) args.push("--effort", options.effort);
  if (options.systemPrompt !== undefined) args.push("--system-prompt", options.systemPrompt);
  return args;
}
