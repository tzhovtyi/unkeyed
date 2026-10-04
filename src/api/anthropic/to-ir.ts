/** A Messages API request → the IR. Flattening lives in `ir/transcript.ts`. */
import {
  BlockWriter,
  DEFAULT_SYSTEM_PROMPT,
  EFFORT_LEVELS,
  flatten,
  type Effort,
  type Request,
  type ToolIntent,
  type ToolSpec,
  type Turn,
} from "../../ir/index.js";
import { BadRequestError } from "./errors.js";
import type {
  ContentBlockParam,
  DocumentBlockParam,
  MessageCreateParams,
  MessageParam,
  ThinkingConfigParam,
  Tool,
  ToolChoice,
  ToolResultBlockParam,
} from "./protocol.js";

export { DEFAULT_SYSTEM_PROMPT, EFFORT_LEVELS };
export type { Effort };

export type TranslateOptions = {
  /** Forces a model regardless of what the request asked for. */
  model?: string | undefined;
  modelMap?: Record<string, string> | undefined;
  effort?: Effort | undefined;
  defaultSystemPrompt?: string | undefined;
  transcriptPreamble?: string | undefined;
  unsupported?: "ignore" | "warn" | "throw" | undefined;
  /** Keeps `thinking` blocks even when the request did not ask for them. */
  includeThinking?: boolean | undefined;
  documents?: "text" | "omit" | undefined;
};

export type Translated = {
  request: Request;
  warnings: string[];
};

export function toRequest(params: MessageCreateParams, options: TranslateOptions): Translated {
  if (!params.model) throw new BadRequestError("model is required");
  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    throw new BadRequestError("messages must be a non-empty array");
  }

  const warnings: string[] = [];
  const unsupported = options.unsupported ?? "warn";
  const note = (message: string): void => {
    if (unsupported === "throw") throw new BadRequestError(message);
    if (unsupported === "warn") warnings.push(message);
  };

  for (const name of ["temperature", "top_p", "top_k"] as const) {
    if (params[name] !== undefined) {
      note(`\`${name}\` is not supported by the CLI and was ignored.`);
    }
  }

  const turns = params.messages.map((message) => renderTurn(message, options, warnings));
  const { prompt, framed } = flatten(turns, { preamble: options.transcriptPreamble });
  if (prompt.length === 0) throw new BadRequestError("messages contained no renderable content");
  if (framed) {
    note(
      `${params.messages.length} messages were flattened into a single turn; ` +
        "the CLI cannot replay a conversation without re-answering it.",
    );
  }

  return {
    request: {
      model: resolveModel(params.model, options),
      systemPrompt: systemPrompt(params.system, options),
      prompt,
      effort: effortFor(params.thinking, options.effort),
      tools: toolIntent(params.tools, params.tool_choice),
      stopSequences: params.stop_sequences ?? [],
      includeThinking: options.includeThinking ?? params.thinking?.type === "enabled",
    },
    warnings,
  };
}

function resolveModel(model: string, options: TranslateOptions): string {
  if (options.model !== undefined) return options.model;
  return options.modelMap?.[model] ?? model;
}

function systemPrompt(system: MessageCreateParams["system"], options: TranslateOptions): string {
  if (typeof system === "string" && system.length > 0) return system;
  if (Array.isArray(system) && system.length > 0) {
    return system.map((block) => block.text).join("\n\n");
  }
  return options.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT;
}

/** `thinking.budget_tokens` → an effort level, at the API's own preset thresholds. */
export function effortFor(
  thinking: ThinkingConfigParam | undefined,
  override: Effort | undefined,
): Effort | undefined {
  if (override !== undefined) return override;
  if (thinking?.type !== "enabled") return undefined;
  const budget = thinking.budget_tokens;
  if (budget <= 4_096) return "low";
  if (budget <= 10_000) return "medium";
  if (budget <= 24_000) return "high";
  if (budget <= 48_000) return "xhigh";
  return "max";
}

/** A forced choice resolves to the tool here, where a bad name is still a bad request. */
function toolIntent(tools: Tool[] | undefined, toolChoice: ToolChoice | undefined): ToolIntent {
  if (!tools || tools.length === 0) return { kind: "none" };
  if (toolChoice?.type === "none") return { kind: "none" };

  const specs = tools.map(toSpec);
  const forced = forcedToolName(tools, toolChoice);
  if (forced === undefined) return { kind: "auto", tools: specs };

  const tool = specs.find((candidate) => candidate.name === forced);
  if (!tool) throw new BadRequestError(`tool_choice names "${forced}", which is not in tools`);
  return { kind: "forced", tools: specs, tool };
}

function toSpec(tool: Tool): ToolSpec {
  return { name: tool.name, description: tool.description ?? "", schema: tool.input_schema };
}

function forcedToolName(tools: Tool[], toolChoice: ToolChoice | undefined): string | undefined {
  if (toolChoice?.type === "tool") return toolChoice.name;
  // `any` means "some tool, you pick", which is only determinate when there is one.
  const only = tools[0];
  if (toolChoice?.type === "any" && tools.length === 1 && only) return only.name;
  return undefined;
}

/** One message, rendered down to the text and images a CLI can be handed. */
function renderTurn(message: MessageParam, options: TranslateOptions, warnings: string[]): Turn {
  const writer = new BlockWriter();
  render(message.content, writer, options, warnings);
  return { role: message.role, blocks: writer.done() };
}

function render(
  content: MessageParam["content"],
  writer: BlockWriter,
  options: TranslateOptions,
  warnings: string[],
): void {
  if (typeof content === "string") {
    writer.text(content);
    return;
  }
  for (const block of content) {
    renderBlock(block, writer, options, warnings);
  }
}

function renderBlock(
  block: ContentBlockParam,
  writer: BlockWriter,
  options: TranslateOptions,
  warnings: string[],
): void {
  switch (block.type) {
    case "text":
      writer.text(block.text);
      return;
    case "image":
      writer.image(block);
      return;
    case "document": {
      const text = documentText(block, options, warnings);
      if (text !== undefined) writer.text(text);
      return;
    }
    case "tool_use":
      writer.text(
        `<tool_use id="${block.id}" name="${block.name}">\n${JSON.stringify(block.input, null, 2)}\n</tool_use>`,
      );
      return;
    case "tool_result":
      writer.text(renderToolResult(block, writer));
      return;
    case "thinking":
    case "redacted_thinking":
      // Re-sending a prior turn's reasoning invites the model to treat it as instructions.
      return;
    default:
      return;
  }
}

function renderToolResult(block: ToolResultBlockParam, writer: BlockWriter): string {
  const parts: string[] = [];
  if (typeof block.content === "string") {
    parts.push(block.content);
  } else if (Array.isArray(block.content)) {
    for (const inner of block.content) {
      if (inner.type === "text") parts.push(inner.text);
      else if (inner.type === "image") writer.image(inner);
    }
  }
  const failed = block.is_error ? ' is_error="true"' : "";
  return `<tool_result tool_use_id="${block.tool_use_id}"${failed}>\n${parts.join("\n")}\n</tool_result>`;
}

/** Media types whose bytes are text. See {@link documentText}. */
const TEXTUAL = /^text\/|^application\/(json|xml|yaml|x-yaml|x-ndjson|javascript|sql)|\+(json|xml)$/;

/** Documents become text; unreadable ones are refused unless `documents: "omit"`. */
function documentText(
  block: DocumentBlockParam,
  options: TranslateOptions,
  warnings: string[],
): string | undefined {
  const source = block.source;
  const title = block.title ? ` title="${block.title}"` : "";
  const wrap = (body: string): string =>
    `<document${title}>\n${block.context ? `${block.context}\n\n` : ""}${body}\n</document>`;

  if (source.type === "text") return wrap(source.data);

  if (source.type === "base64" && TEXTUAL.test(source.media_type)) {
    return wrap(Buffer.from(source.data, "base64").toString("utf8"));
  }

  const what = source.type === "url" ? `a URL (${source.url})` : `type ${source.media_type}`;
  const message =
    `A document block with ${what} cannot be sent through the CLI, which has no way to fetch ` +
    "or extract one. Pass the extracted text as a text block, or as a document with " +
    '`source: { type: "text", data: "..." }`.';
  if (options.documents === "omit") {
    warnings.push(`${message} The document was omitted.`);
    return undefined;
  }
  throw new BadRequestError(message);
}
