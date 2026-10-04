import type { Usage } from "../../ir/index.js";
import type { CliUsage } from "./events.js";

/** Cache reads and writes are prompt tokens too, so they count here. */
export function promptTokens(usage: CliUsage | undefined): number {
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

const SERVICE_TIERS = ["standard", "priority", "batch"] as const;

/** The CLI's loose usage block, filled out into the IR's complete one. */
export function toUsage(usage: CliUsage): Usage {
  const tier = SERVICE_TIERS.find((candidate) => candidate === usage.service_tier) ?? null;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    cache_creation: usage.cache_creation
      ? {
          ephemeral_1h_input_tokens: usage.cache_creation.ephemeral_1h_input_tokens ?? 0,
          ephemeral_5m_input_tokens: usage.cache_creation.ephemeral_5m_input_tokens ?? 0,
        }
      : null,
    output_tokens_details: usage.output_tokens_details
      ? { thinking_tokens: usage.output_tokens_details.thinking_tokens ?? 0 }
      : null,
    server_tool_use: usage.server_tool_use
      ? {
          web_fetch_requests: usage.server_tool_use.web_fetch_requests ?? 0,
          web_search_requests: usage.server_tool_use.web_search_requests ?? 0,
        }
      : null,
    service_tier: tier,
    inference_geo: usage.inference_geo ?? null,
  };
}
