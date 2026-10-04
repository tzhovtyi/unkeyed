/** The event vocabulary: Anthropic streaming shapes, which Claude Code emits verbatim. */

export type TextBlock = {
  type: "text";
  text: string;
  /** Always null: citations need a server-side document the CLI never sees. */
  citations: null;
};

export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};

export type RedactedThinkingBlock = {
  type: "redacted_thinking";
  data: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  /** `direct`: a tool the caller runs, never a server-side one. */
  caller: { type: "direct" };
};

export type ContentBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock;

/** The API's usage block field for field; adapters normalize their loose shape into it. */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number } | null;
  output_tokens_details: { thinking_tokens: number } | null;
  server_tool_use: { web_fetch_requests: number; web_search_requests: number } | null;
  service_tier: "standard" | "priority" | "batch" | null;
  inference_geo: string | null;
};

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    inference_geo: null,
  };
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | null;

/** What a measured call cost, alongside the API-shaped response. */
export type UnkeyedMeta = {
  costUsd: number;
  durationMs: number;
  /** Above 1 means a tool round-trip happened inside the CLI. */
  numTurns: number;
  warnings: string[];
};

export function emptyMeta(warnings: readonly string[]): UnkeyedMeta {
  return { costUsd: 0, durationMs: 0, numTurns: 0, warnings: [...warnings] };
}

export type Message = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: Usage;
  // Always null: each needs something server-side the CLI never sees.
  container: null;
  diagnostics: null;
  stop_details: null;
  /** What the CLI billed for this call. Not part of the Anthropic API. */
  _unkeyed: UnkeyedMeta;
};

export type MessageStartEvent = {
  type: "message_start";
  message: Message;
};

export type ContentBlockStartEvent = {
  type: "content_block_start";
  index: number;
  content_block: ContentBlock;
};

export type TextDelta = { type: "text_delta"; text: string };
export type ThinkingDelta = { type: "thinking_delta"; thinking: string };
export type SignatureDelta = { type: "signature_delta"; signature: string };
export type InputJsonDelta = { type: "input_json_delta"; partial_json: string };

export type ContentBlockDeltaEvent = {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | ThinkingDelta | SignatureDelta | InputJsonDelta;
};

export type ContentBlockStopEvent = {
  type: "content_block_stop";
  index: number;
};

export type MessageDeltaEvent = {
  type: "message_delta";
  delta: { stop_reason: StopReason; stop_sequence: string | null };
  usage: { output_tokens: number };
};

export type MessageStopEvent = { type: "message_stop" };

export type MessageStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

/** Accounting no streaming event has a field for: cost, the real model id. */
export type MetaPatch = {
  model?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  usage?: Usage;
  warning?: string;
};

/** An event a caller can see, or bookkeeping only the accumulator wants. */
export type IrEvent =
  | { kind: "event"; event: MessageStreamEvent }
  | { kind: "meta"; patch: MetaPatch };
