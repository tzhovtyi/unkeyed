/** `Unkeyed`: the Anthropic Messages API answered by a local CLI. See `src/README.md`. */
export * from "./api/anthropic/index.js";
export {
  CliAbortError,
  CliError,
  CliExitError,
  CliNoOutputError,
  CliNotFoundError,
  CliParseError,
  CliRateLimitError,
  CliResponseError,
  CliTimeoutError,
} from "./core/errors.js";
export type { Completion } from "./ir/index.js";
