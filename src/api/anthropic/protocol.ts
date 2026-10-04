/** The request side of the Messages API; the response side is the IR's, re-exported here. */
export type {
  UnkeyedMeta,
  ContentBlock,
  ContentBlockDeltaEvent,
  ContentBlockStartEvent,
  ContentBlockStopEvent,
  InputJsonDelta,
  Message,
  MessageDeltaEvent,
  MessageStartEvent,
  MessageStopEvent,
  MessageStreamEvent,
  RedactedThinkingBlock,
  SignatureDelta,
  StopReason,
  TextBlock,
  TextDelta,
  ThinkingBlock,
  ThinkingDelta,
  ToolUseBlock,
  Usage,
} from "../../ir/index.js";
export type { Base64Source, UrlSource } from "../../ir/index.js";

import type { Base64Source, UrlSource } from "../../ir/index.js";

export type TextBlockParam = {
  type: "text";
  text: string;
  cache_control?: unknown;
  citations?: unknown;
};

export type TextSource = {
  type: "text";
  media_type?: string;
  data: string;
};

export type ImageBlockParam = {
  type: "image";
  source: Base64Source | UrlSource;
  cache_control?: unknown;
};

export type DocumentBlockParam = {
  type: "document";
  source: Base64Source | UrlSource | TextSource;
  title?: string | null;
  context?: string | null;
  citations?: unknown;
  cache_control?: unknown;
};

export type ToolUseBlockParam = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: unknown;
};

export type ToolResultBlockParam = {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<TextBlockParam | ImageBlockParam> | undefined;
  is_error?: boolean;
  cache_control?: unknown;
};

export type ThinkingBlockParam = {
  type: "thinking";
  thinking: string;
  signature: string;
};

export type RedactedThinkingBlockParam = {
  type: "redacted_thinking";
  data: string;
};

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | DocumentBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam;

export type MessageParam = {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
};

export type Tool = {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments. */
  input_schema: Record<string, unknown>;
  type?: string | undefined;
  cache_control?: unknown;
};

export type ToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

export type ThinkingConfigParam =
  | { type: "enabled"; budget_tokens: number }
  | { type: "disabled" };

export type MessageCreateParams = {
  model: string;
  /** Required by the API, but the CLI has no output cap, so nothing enforces it. */
  max_tokens: number;
  messages: MessageParam[];
  system?: string | TextBlockParam[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
  thinking?: ThinkingConfigParam;
  stop_sequences?: string[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  metadata?: { user_id?: string | null } & Record<string, unknown>;
  // Absorbs fields this package does not model, so SDK call sites type-check.
  [key: string]: unknown;
};

export type MessageCountTokensParams = {
  model?: string;
  messages: MessageParam[];
  system?: string | TextBlockParam[];
  tools?: Tool[];
  [key: string]: unknown;
};

export type MessageTokensCount = {
  input_tokens: number;
  /** Not in the API. `true` because the CLI cannot count without spending a call. */
  _estimated: boolean;
};

export type ModelInfo = {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
};

export type ModelsPage = {
  data: ModelInfo[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
};
