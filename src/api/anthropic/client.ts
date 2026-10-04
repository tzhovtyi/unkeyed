/** The Anthropic SDK's shape, answered by the local CLI named in the `cli` option. */
import { scratchDir } from "../../core/sandbox.js";
import type { CliAdapter } from "../../cli/adapter.js";
import { claudeCode } from "../../cli/claude/index.js";
import { start } from "../../cli/run.js";
import type { IrEvent } from "../../ir/index.js";
import { NotImplementedError, asApiError, InternalServerError } from "./errors.js";
import { assemble } from "./from-ir.js";
import type {
  Message,
  MessageCountTokensParams,
  MessageCreateParams,
  MessageTokensCount,
  ModelsPage,
  Tool,
} from "./protocol.js";
import { UnkeyedStream, MessageStream } from "./stream.js";
import { toRequest, type Effort, type TranslateOptions } from "./to-ir.js";

const DEFAULT_TIMEOUT_MS = 600_000;

export type UnkeyedOptions = TranslateOptions & {
  /** Which CLI answers. Defaults to Claude Code. */
  cli?: CliAdapter<unknown> | undefined;
  /** Defaults to the adapter's own binary, resolved on `PATH`. */
  cliPath?: string | undefined;
  /** Default 600000 (ten minutes). */
  timeoutMs?: number | undefined;
  /** Accepted as the SDK spells it; `timeoutMs` wins if both are given. */
  timeout?: number | undefined;
  /** Defaults to a fresh empty temporary directory. */
  cwd?: string | undefined;
  /** API-key variables are removed either way. */
  env?: Record<string, string | undefined> | undefined;
  /** Ignored. Present so `new Unkeyed({ apiKey })` type-checks at the swap point. */
  apiKey?: string | null | undefined;
  /** Ignored: there is no endpoint to point at. */
  baseURL?: string | null | undefined;
  /** Ignored. A local CLI failure is not the transient kind retrying fixes. */
  maxRetries?: number | undefined;
};

export type RequestOptions = {
  signal?: AbortSignal | undefined;
  timeout?: number | undefined;
  headers?: Record<string, string> | undefined;
  maxRetries?: number | undefined;
};

type Prepared = {
  source: AsyncGenerator<IrEvent>;
  controller: AbortController;
  model: string;
  warnings: string[];
};

export class Messages {
  constructor(private readonly client: Unkeyed) {}

  create(params: MessageCreateParams & { stream: true }, options?: RequestOptions): Promise<UnkeyedStream>;
  create(params: MessageCreateParams & { stream?: false }, options?: RequestOptions): Promise<Message>;
  create(params: MessageCreateParams, options?: RequestOptions): Promise<Message | UnkeyedStream>;
  async create(
    params: MessageCreateParams,
    options?: RequestOptions,
  ): Promise<Message | UnkeyedStream> {
    const prepared = await this.client.prepare(params, options);
    if (params.stream === true) {
      return new UnkeyedStream(prepared.source, prepared.controller, prepared.model, prepared.warnings);
    }
    return assemble(prepared.source, prepared.model, prepared.warnings);
  }

  get batches(): never {
    throw new NotImplementedError(
      "messages.batches",
      "batching is a server-side queue, and the CLI answers one call at a time",
    );
  }

  async stream(params: MessageCreateParams, options?: RequestOptions): Promise<MessageStream> {
    const prepared = await this.client.prepare({ ...params, stream: true }, options);
    return new MessageStream(prepared.source, prepared.controller, prepared.model, prepared.warnings);
  }

  /** An **estimate**: the CLI has no token-counting endpoint. */
  async countTokens(
    params: MessageCountTokensParams,
    _options?: RequestOptions,
  ): Promise<MessageTokensCount> {
    this.client.warn(
      "`messages.countTokens` is estimated, not measured: the CLI has no token-counting endpoint.",
    );
    return { input_tokens: estimateTokens(params), _estimated: true };
  }
}

export class Unkeyed {
  readonly messages: Messages = new Messages(this);
  /** The same implementation: `betas` and friends are ignored. */
  readonly beta: { messages: Messages };
  readonly models: {
    list(options?: RequestOptions): Promise<ModelsPage>;
    retrieve(id: string, options?: RequestOptions): Promise<ModelsPage["data"][number]>;
  };

  get completions(): never {
    throw new NotImplementedError("completions", "the CLI only speaks the Messages API");
  }

  get files(): never {
    throw new NotImplementedError(
      "files",
      "uploaded files live on Anthropic's side of an API key, which this client does not have",
    );
  }

  get containers(): never {
    throw new NotImplementedError("containers", "server-side tool containers need the API");
  }

  /** Always null: there is no key, which is the reason to use this client. */
  readonly apiKey: string | null = null;
  /** No endpoint, so this names the CLI that answers instead. */
  readonly baseURL: string;

  private readonly options: UnkeyedOptions;
  private readonly adapter: CliAdapter<unknown>;
  private readonly cliPath: string | undefined;
  private readonly timeoutMs: number;
  private readonly cwd: () => Promise<string>;
  private readonly warned = new Set<string>();

  constructor(options: UnkeyedOptions = {}) {
    this.options = options;
    this.adapter = options.cli ?? claudeCode;
    this.cliPath = options.cliPath;
    this.timeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.baseURL = `cli://${this.adapter.id}`;

    const fixedCwd = options.cwd;
    const sandbox = scratchDir("unkeyed-api-");
    this.cwd = fixedCwd === undefined ? sandbox : async () => fixedCwd;

    this.beta = { messages: this.messages };
    const page = modelsPage(this.adapter);
    this.models = {
      list: async () => page,
      retrieve: async (id: string) => {
        const found = page.data.find((model) => model.id === id);
        if (!found) throw new InternalServerError(`unknown model: ${id}`);
        return found;
      },
    };
  }

  /** Once per client, so logs stay readable. */
  warn(message: string): void {
    if (this.options.unsupported === "ignore" || this.options.unsupported === "throw") return;
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(`[unkeyed] ${message}`);
  }

  /** Internal, but public on the type: `Messages` is a separate object. */
  async prepare(params: MessageCreateParams, options?: RequestOptions): Promise<Prepared> {
    const { request, warnings } = toRequest(params, this.options);
    for (const warning of warnings) this.warn(warning);

    const run = await start({
      adapter: this.adapter,
      binary: this.cliPath,
      request,
      warnings,
      cwd: this.cwd,
      timeoutMs: options?.timeout ?? this.timeoutMs,
      env: this.options.env,
      signal: options?.signal,
    });

    // The adapter's own encoding warnings reach the response too.
    for (const warning of run.warnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
        this.warn(warning);
      }
    }

    return {
      source: translateErrors(run.events),
      controller: run.controller,
      model: params.model,
      warnings,
    };
  }
}

async function* translateErrors(source: AsyncGenerator<IrEvent>): AsyncGenerator<IrEvent> {
  try {
    yield* source;
  } catch (error) {
    throw asApiError(error);
  }
}

function modelsPage(adapter: CliAdapter<unknown>): ModelsPage {
  const data = adapter.models.map((model) => ({
    type: "model" as const,
    id: model.id,
    display_name: model.displayName,
    created_at: model.createdAt,
  }));
  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

/** Four characters per token, plus a flat figure per image. Crude on purpose. */
function estimateTokens(params: MessageCountTokensParams): number {
  let characters = 0;
  let images = 0;

  for (const message of params.messages) {
    if (typeof message.content === "string") {
      characters += message.content.length;
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text") characters += block.text.length;
      else if (block.type === "image") images += 1;
      else if (block.type === "tool_result") characters += JSON.stringify(block.content ?? "").length;
      else characters += JSON.stringify(block).length;
    }
  }

  if (typeof params.system === "string") characters += params.system.length;
  else if (Array.isArray(params.system)) {
    for (const block of params.system) characters += block.text.length;
  }
  for (const tool of params.tools ?? ([] as Tool[])) {
    characters += JSON.stringify(tool).length;
  }

  return Math.ceil(characters / 4) + images * 800;
}

export type { Effort };
