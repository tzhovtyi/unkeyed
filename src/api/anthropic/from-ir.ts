/** IR events → one Messages API response, with metering folded into `_unkeyed`. */
import { randomUUID } from "node:crypto";
import { emptyMeta, emptyUsage } from "../../ir/index.js";
import type { UnkeyedMeta, ContentBlock, IrEvent, Message, StopReason, Usage } from "../../ir/index.js";

/** Builds a complete `Message` from the IR stream. */
export class MessageAccumulator {
  private id = "";
  private model: string;
  private readonly content: ContentBlock[] = [];
  private readonly partialJson = new Map<number, string>();
  private stopReason: StopReason = null;
  private stopSequence: string | null = null;
  private usage: Usage = emptyUsage();
  private readonly meta: UnkeyedMeta;

  constructor(model: string, warnings: readonly string[]) {
    this.model = model;
    this.meta = emptyMeta(warnings);
  }

  push(event: IrEvent): void {
    if (event.kind === "meta") {
      const { patch } = event;
      if (patch.model !== undefined) this.model = patch.model;
      if (patch.costUsd !== undefined) this.meta.costUsd = patch.costUsd;
      if (patch.durationMs !== undefined) this.meta.durationMs = patch.durationMs;
      if (patch.numTurns !== undefined) this.meta.numTurns = patch.numTurns;
      if (patch.usage !== undefined) this.usage = patch.usage;
      if (patch.warning !== undefined) this.meta.warnings.push(patch.warning);
      return;
    }

    const inner = event.event;
    switch (inner.type) {
      case "message_start":
        this.id = inner.message.id;
        this.model = inner.message.model;
        this.usage = inner.message.usage;
        return;
      case "content_block_start":
        this.content[inner.index] = inner.content_block;
        return;
      case "content_block_delta": {
        const block = this.content[inner.index];
        if (!block) return;
        const delta = inner.delta;
        if (delta.type === "text_delta" && block.type === "text") block.text += delta.text;
        else if (delta.type === "thinking_delta" && block.type === "thinking") block.thinking += delta.thinking;
        else if (delta.type === "signature_delta" && block.type === "thinking") block.signature += delta.signature;
        else if (delta.type === "input_json_delta") {
          this.partialJson.set(inner.index, (this.partialJson.get(inner.index) ?? "") + delta.partial_json);
        }
        return;
      }
      case "content_block_stop": {
        const block = this.content[inner.index];
        const json = this.partialJson.get(inner.index);
        this.partialJson.delete(inner.index);
        if (!block || block.type !== "tool_use" || json === undefined) return;
        try {
          block.input = JSON.parse(json) as unknown;
        } catch {
          this.meta.warnings.push(
            `The arguments for tool "${block.name}" were not valid JSON and were dropped.`,
          );
        }
        return;
      }
      case "message_delta":
        this.stopReason = inner.delta.stop_reason;
        this.stopSequence = inner.delta.stop_sequence;
        if (inner.usage.output_tokens > 0) this.usage.output_tokens = inner.usage.output_tokens;
        return;
      default:
        return;
    }
  }

  message(): Message {
    return {
      id: this.id || `msg_${randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      model: this.model,
      content: this.content.filter((block): block is ContentBlock => block != null),
      stop_reason: this.stopReason ?? "end_turn",
      stop_sequence: this.stopSequence,
      usage: this.usage,
      container: null,
      diagnostics: null,
      stop_details: null,
      _unkeyed: this.meta,
    };
  }
}

/** Reads an IR stream to the end and returns the finished message. */
export async function assemble(
  source: AsyncIterable<IrEvent>,
  model: string,
  warnings: readonly string[],
): Promise<Message> {
  const accumulator = new MessageAccumulator(model, warnings);
  for await (const event of source) accumulator.push(event);
  return accumulator.message();
}
