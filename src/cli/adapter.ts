/** What a CLI must provide to be usable by any surface. See `src/README.md`. */
import type { CompletionRequest, IrEvent, ModelDescriptor, Request } from "../ir/index.js";

export type Invocation<Plan> = {
  args: string[];
  stdin: string;
  plan: Plan;
  warnings: string[];
};

export type EncodeContext = {
  /** Created on first call, removed when the call ends. */
  scratchDir(): Promise<string>;
};

export type DecodeContext<Plan> = {
  plan: Plan;
  /** Reasoning blocks are dropped unless this is set: CLIs think unprompted. */
  includeThinking: boolean;
  stopSequences: readonly string[];
  warnings: readonly string[];
};

export type CliAdapter<Plan = unknown> = {
  readonly id: string;
  /** Looked up on `PATH` unless the caller overrides it. */
  readonly defaultBinary: string;
  readonly notFoundHint: string;
  /** Credentials to delete: a stray API key would bill the API instead. */
  readonly strippedEnv: readonly string[];
  readonly models: readonly ModelDescriptor[];

  encode(request: Request, context: EncodeContext): Promise<Invocation<Plan>>;

  /** Return once the answer is complete; the runner then kills the child. */
  decode(lines: AsyncGenerator<unknown>, context: DecodeContext<Plan>): AsyncGenerator<IrEvent>;
};

/** What the one-shot client needs: one prompt in, one JSON envelope (`Raw`) out. */
export type CompletionAdapter<Raw = unknown> = {
  readonly id: string;
  readonly defaultBinary: string;
  readonly notFoundHint: string;
  readonly strippedEnv: readonly string[];
  /** The cheapest prompt that still returns a usage block. */
  readonly overheadProbe: string;

  args(request: CompletionRequest): string[];

  /** Raises `CliParseError` if stdout is not the envelope that was asked for. */
  parse(stdout: string, command: string): Raw;

  /** Raises `CliResponseError` if the envelope reports a failure. */
  read(raw: Raw, command: string): CompletionReading;
};

/** What one envelope says, before the overhead subtraction is applied. */
export type CompletionReading = {
  answer: string;
  /** Everything the prompt was billed for, cache reads and writes included. */
  promptTokens: number;
  outputTokens: number;
  costUsd: number;
  /** The CLI's own figure, when it reports one; otherwise measured by the client. */
  latencyMs?: number | undefined;
  warnings: string[];
};
