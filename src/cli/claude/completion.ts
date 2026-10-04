/** The one-shot half of the adapter: `--output-format json`, one envelope. */
import { CliParseError, CliResponseError } from "../../core/errors.js";
import type { CompletionReading } from "../adapter.js";
import type { ClaudeCliResult } from "./events.js";
import { promptTokens } from "./usage.js";

export function parse(stdout: string, command: string): ClaudeCliResult {
  try {
    return JSON.parse(stdout) as ClaudeCliResult;
  } catch (error) {
    throw new CliParseError(command, stdout, { cause: error });
  }
}

export function read(raw: ClaudeCliResult, command: string): CompletionReading {
  if (raw.is_error) {
    throw new CliResponseError(
      `${command} returned an error (${raw.subtype ?? "unknown"}` +
        `${raw.api_error_status ? `, api_status=${raw.api_error_status}` : ""}): ` +
        (raw.result ?? "no details"),
      { subtype: raw.subtype, apiErrorStatus: raw.api_error_status },
    );
  }

  const warnings: string[] = [];
  if (raw.permission_denials?.length) {
    warnings.push(
      `The model attempted a tool call ${raw.permission_denials.length} time(s), ` +
        "so the answer may be incomplete.",
    );
  }

  return {
    answer: (raw.result ?? "").trim(),
    promptTokens: promptTokens(raw.usage),
    outputTokens: raw.usage?.output_tokens ?? 0,
    costUsd: raw.total_cost_usd ?? 0,
    latencyMs: raw.duration_ms,
    warnings,
  };
}
