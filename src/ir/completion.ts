import type { Effort } from "./request.js";

/** One measured completion, as every provider reports it. */
export type Completion = {
  answer: string;
  /** What the CLI billed, harness overhead included. */
  promptTokens: number;
  outputTokens: number;
  /** Attributable to your context: `promptTokens` less the overhead. */
  contextTokens: number;
  overheadTokens: number;
  costUsd: number;
  latencyMs: number;
  warnings: string[];
};

/** A one-shot client's fixed settings; the prompt goes to stdin per call. */
export type CompletionRequest = {
  /** Names in the CLI's own vocabulary (`Read`, `Grep`), not the caller's. */
  tools: readonly string[];
  model?: string | undefined;
  effort?: Effort | undefined;
  systemPrompt?: string | undefined;
};
