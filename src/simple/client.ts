/** One measured completion from any CLI: overhead is measured once, then subtracted. */
import { once } from "../core/once.js";
import { scratchDir } from "../core/sandbox.js";
import { runText } from "../core/spawn.js";
import type { CompletionAdapter } from "../cli/adapter.js";
import type { Completion, Effort } from "../ir/index.js";

export type CompletionOptions = {
  /** Path to the binary. Defaults to the adapter's own, resolved on `PATH`. */
  cliPath?: string;
  /** Omitted when unset, leaving the CLI's own default. */
  model?: string;
  /** Omitted when unset, leaving the CLI's own default. */
  effort?: Effort;
  /** Omitted when unset, leaving the CLI's ~8.7k-token built-in prompt in place. */
  systemPrompt?: string;
  /** Empty by default; enabling tools gives the model your filesystem and network. */
  tools?: readonly string[];
  /** Hard stop for a single call. Default 600000 (ten minutes). */
  timeoutMs?: number;
  /** Defaults to a fresh empty temporary directory. See `scratchDir`. */
  cwd?: string;
  /** Skips the overhead probe, saving one billed call per client. */
  overheadTokens?: number;
};

export type MeasuredCompletion<Raw> = Completion & {
  /** The raw envelope, for fields this package does not model. */
  raw: Raw;
};

export type CompletionClient<Raw> = {
  /** One measured answer. Rejects with a `CliError` subclass on failure. */
  complete(prompt: string): Promise<MeasuredCompletion<Raw>>;
  /** Prompt tokens charged before any of your context. Measured once, cached. */
  overheadTokens(): Promise<number>;
};

const DEFAULT_TIMEOUT_MS = 600_000;

export function createCompletionClient<Raw>(
  adapter: CompletionAdapter<Raw>,
  options: CompletionOptions = {},
): CompletionClient<Raw> {
  const command = options.cliPath ?? adapter.defaultBinary;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = adapter.args({
    tools: options.tools ?? [],
    model: options.model,
    effort: options.effort,
    systemPrompt: options.systemPrompt,
  });

  // Bound to a local so the undefined check narrows without a cast.
  const fixedCwd = options.cwd;
  const sandbox = scratchDir(`unkeyed-${adapter.id}-`);
  const resolveCwd = fixedCwd === undefined ? sandbox : async () => fixedCwd;

  async function run(prompt: string): Promise<Raw> {
    const stdout = await runText({
      command,
      args,
      stdin: prompt,
      cwd: await resolveCwd(),
      timeoutMs,
      notFoundHint: adapter.notFoundHint,
      strippedEnv: adapter.strippedEnv,
    });
    return adapter.parse(stdout, command);
  }

  const knownOverhead = options.overheadTokens;
  const overheadTokens =
    knownOverhead === undefined
      ? once(async () => adapter.read(await run(adapter.overheadProbe), command).promptTokens)
      : async () => knownOverhead;

  return {
    overheadTokens,

    async complete(prompt: string): Promise<MeasuredCompletion<Raw>> {
      // Awaited first so the probe can never overlap the timed call.
      const overhead = await overheadTokens();
      const startedAt = Date.now();
      const raw = await run(prompt);
      const reading = adapter.read(raw, command);

      return {
        answer: reading.answer,
        promptTokens: reading.promptTokens,
        outputTokens: reading.outputTokens,
        contextTokens: Math.max(0, reading.promptTokens - overhead),
        overheadTokens: overhead,
        costUsd: reading.costUsd,
        latencyMs: reading.latencyMs ?? Date.now() - startedAt,
        warnings: reading.warnings,
        raw,
      };
    },
  };
}
