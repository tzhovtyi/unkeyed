/** Claude Code, as an adapter: both CLI contracts, in one object. */
import type { CliAdapter, CompletionAdapter } from "../adapter.js";
import type { CompletionRequest } from "../../ir/index.js";
import { completionArgs } from "./args.js";
import { decode } from "./decode.js";
import { encode } from "./encode.js";
import type { ClaudeCliResult } from "./events.js";
import { MODELS } from "./models.js";
import { parse, read } from "./completion.js";
import type { ToolPlan } from "./tools.js";

const NOT_FOUND_HINT =
  "unkeyed answers through a local Claude Code install and never reads an API key. " +
  "Install it from https://claude.com/claude-code, or point `cliPath` at the binary.";

/** These would send the call to the API and bill it there. */
const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

const IDENTITY = {
  id: "claude-code",
  defaultBinary: "claude",
  notFoundHint: NOT_FOUND_HINT,
  strippedEnv: STRIPPED_ENV,
} as const;

export const claudeCode: CliAdapter<ToolPlan> = {
  ...IDENTITY,
  models: MODELS,
  encode,
  decode,
};

export const claudeCodeCompletion: CompletionAdapter<ClaudeCliResult> = {
  ...IDENTITY,
  /** Cheapest call that still returns a usage block. */
  overheadProbe: "Reply with one word: ready",
  args: (request: CompletionRequest) =>
    completionArgs({
      tools: request.tools,
      model: request.model,
      effort: request.effort,
      systemPrompt: request.systemPrompt,
    }),
  parse,
  read,
};

export { MODELS } from "./models.js";
export { promptTokens } from "./usage.js";
export type { ClaudeCliResult, CliUsage } from "./events.js";
export type { ToolPlan } from "./tools.js";
