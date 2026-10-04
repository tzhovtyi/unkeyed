/** The measured one-shot client, bound to Claude Code. */
import { claudeCodeCompletion } from "../cli/claude/index.js";
import type { ClaudeCliResult } from "../cli/claude/index.js";
import {
  createCompletionClient,
  type CompletionClient,
  type CompletionOptions,
  type MeasuredCompletion,
} from "./client.js";

export type ClaudeOptions = CompletionOptions;
export type ClaudeCompletion = MeasuredCompletion<ClaudeCliResult>;
export type ClaudeClient = CompletionClient<ClaudeCliResult>;

export function createClaude(options: ClaudeOptions = {}): ClaudeClient {
  return createCompletionClient(claudeCodeCompletion, options);
}

export { EFFORT_LEVELS } from "../ir/index.js";
export type { Completion, Effort } from "../ir/index.js";
export type { ClaudeCliResult } from "../cli/claude/index.js";
