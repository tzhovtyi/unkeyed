/** One call: encode, spawn, decode, clean up. Error translation stays with the surface. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CliNoOutputError } from "../core/errors.js";
import { runJsonLines } from "../core/spawn.js";
import type { IrEvent, Request } from "../ir/index.js";
import type { CliAdapter, DecodeContext } from "./adapter.js";

export type StartOptions<Plan> = {
  adapter: CliAdapter<Plan>;
  /** Path to the binary. Defaults to the adapter's own. */
  binary?: string | undefined;
  request: Request;
  /** Seeded onto the first message snapshot, so a streaming consumer sees them. */
  warnings?: readonly string[] | undefined;
  /** Resolved late, so a client's scratch directory is created only once used. */
  cwd: () => Promise<string>;
  timeoutMs: number;
  env?: Record<string, string | undefined> | undefined;
  signal?: AbortSignal | undefined;
};

export type Run = {
  /** Iterating to the end is what finishes the call. */
  events: AsyncGenerator<IrEvent>;
  controller: AbortController;
  warnings: string[];
};

export async function start<Plan>(options: StartOptions<Plan>): Promise<Run> {
  const { adapter, request, cwd, timeoutMs, env, signal } = options;
  const command = options.binary ?? adapter.defaultBinary;

  let scratch: string | undefined;
  const invocation = await adapter.encode(request, {
    scratchDir: async () => (scratch ??= await mkdtemp(path.join(tmpdir(), `unkeyed-${adapter.id}-tools-`))),
  });

  // Copied onto our own controller so the handle we return can abort too.
  const controller = new AbortController();
  if (signal?.aborted === true) controller.abort();
  else signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const stream = runJsonLines({
    command,
    args: invocation.args,
    stdin: invocation.stdin,
    cwd: await cwd(),
    timeoutMs,
    env,
    signal: controller.signal,
    notFoundHint: adapter.notFoundHint,
    strippedEnv: adapter.strippedEnv,
  });

  const context: DecodeContext<Plan> = {
    plan: invocation.plan,
    includeThinking: request.includeThinking,
    stopSequences: request.stopSequences,
    warnings: [...(options.warnings ?? []), ...invocation.warnings],
  };

  async function* events(): AsyncGenerator<IrEvent> {
    let produced = false;
    try {
      for await (const event of adapter.decode(stream.lines, context)) {
        produced = true;
        yield event;
      }
      // Otherwise an empty message would look like an answer.
      if (!produced) throw new CliNoOutputError(command);
    } finally {
      // Whether the stream finished, threw, or was abandoned half-read.
      stream.stop();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  }

  return { events: events(), controller, warnings: invocation.warnings };
}
