/** The measured one-shot surface, generic over any `CompletionAdapter`. */
export { createCompletionClient } from "./client.js";
export type {
  CompletionClient,
  CompletionOptions,
  MeasuredCompletion,
} from "./client.js";
export { createClaude } from "./claude.js";
export type { ClaudeClient, ClaudeCompletion, ClaudeOptions } from "./claude.js";
