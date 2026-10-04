/** Claude Code's `stream-json` events: one JSON object per line. */
import type { MessageStreamEvent } from "../../ir/index.js";

/** As the CLI reports it: every field optional, cache fields sometimes absent. */
export type CliUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } | null;
  output_tokens_details?: { thinking_tokens?: number } | null;
  server_tool_use?: { web_fetch_requests?: number; web_search_requests?: number } | null;
  service_tier?: string | null;
  inference_geo?: string | null;
};

export type CliSystemEvent = {
  type: "system";
  subtype: string;
  model?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
};

export type CliStreamEvent = {
  type: "stream_event";
  event: MessageStreamEvent;
};

export type CliAssistantEvent = {
  type: "assistant";
  message: { id?: string; model?: string; usage?: CliUsage };
};

export type CliUserEvent = {
  type: "user";
};

/** The CLI's own field names (`resetsAt`), not the rate-limit headers'. */
export type CliRateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: {
    status: "allowed" | string;
    resetsAt?: number;
    rateLimitType?: string;
    message?: string;
  };
};

export type CliResultEvent = {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  api_error_status?: string | null;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: CliUsage;
};

export type CliEvent =
  | CliSystemEvent
  | CliStreamEvent
  | CliAssistantEvent
  | CliUserEvent
  | CliRateLimitEvent
  | CliResultEvent;

export function isCliEvent(value: unknown): value is CliEvent {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** The `--output-format json` envelope, printed once by a one-shot call. */
export type ClaudeCliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: string | null;
  permission_denials?: unknown[];
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: CliUsage;
};
