/** Claude Code events → IR events: mostly removal, and it ends at the tool-use turn. */
import { CliRateLimitError, CliResponseError } from "../../core/errors.js";
import {
  StopSequenceGate,
  emptyMeta,
  type ContentBlock,
  type IrEvent,
  type MessageStreamEvent,
  type MetaPatch,
} from "../../ir/index.js";
import type { DecodeContext } from "../adapter.js";
import { isCliEvent, type CliEvent, type CliUsage } from "./events.js";
import { originalToolName, type ToolPlan } from "./tools.js";
import { toUsage } from "./usage.js";

/** Translates one CLI event into zero or more IR events. */
class Translator {
  /** CLI block index → the index we emit, absent for dropped blocks. */
  private readonly indices = new Map<number, number>();
  private readonly gates = new Map<number, StopSequenceGate>();
  private nextIndex = 0;
  private sawToolUse = false;
  finished = false;

  constructor(private readonly context: DecodeContext<ToolPlan>) {}

  translate(event: CliEvent): IrEvent[] {
    switch (event.type) {
      case "rate_limit_event": {
        const info = event.rate_limit_info;
        if (info.status !== "allowed") {
          throw new CliRateLimitError(
            info.message ??
              `The ${info.rateLimitType ?? "subscription"} limit for this CLI account is exhausted.`,
            { resetsAt: info.resetsAt, rateLimitType: info.rateLimitType },
          );
        }
        return [];
      }

      case "result": {
        this.finished = true;
        if (event.is_error === true) {
          throw new CliResponseError(event.result ?? `the CLI failed (${event.subtype ?? "unknown"})`, {
            subtype: event.subtype,
            apiErrorStatus: event.api_error_status,
          });
        }
        const patch: MetaPatch = {};
        if (event.total_cost_usd !== undefined) patch.costUsd = event.total_cost_usd;
        if (event.duration_ms !== undefined) patch.durationMs = event.duration_ms;
        if (event.num_turns !== undefined) patch.numTurns = event.num_turns;
        if (event.usage !== undefined) patch.usage = toUsage(event.usage);
        return [{ kind: "meta", patch }];
      }

      case "stream_event":
        return this.inner(event.event);

      default:
        return [];
    }
  }

  private inner(event: MessageStreamEvent): IrEvent[] {
    switch (event.type) {
      case "message_start": {
        const message = event.message;
        // The CLI's usage block omits fields the API always includes.
        const usage = toUsage(message.usage as CliUsage);
        return [
          { kind: "meta", patch: { model: message.model } },
          {
            kind: "event",
            event: {
              type: "message_start",
              message: {
                id: message.id,
                type: "message",
                role: "assistant",
                model: message.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage,
                container: null,
                diagnostics: null,
                stop_details: null,
                _unkeyed: emptyMeta(this.context.warnings),
              },
            },
          },
        ];
      }

      case "content_block_start": {
        const block = event.content_block;
        if (isThinking(block) && !this.context.includeThinking) return [];
        const index = this.nextIndex++;
        this.indices.set(event.index, index);
        if (block.type === "text" && this.context.stopSequences.length > 0) {
          this.gates.set(index, new StopSequenceGate(this.context.stopSequences));
        }
        return [
          { kind: "event", event: { type: "content_block_start", index, content_block: this.clean(block) } },
        ];
      }

      case "content_block_delta": {
        const index = this.indices.get(event.index);
        if (index === undefined) return [];
        const gate = this.gates.get(index);
        if (gate && event.delta.type === "text_delta") {
          const { text, matched } = gate.push(event.delta.text);
          const out: IrEvent[] = [];
          if (text.length > 0) {
            out.push({ kind: "event", event: { type: "content_block_delta", index, delta: { type: "text_delta", text } } });
          }
          if (matched !== null) out.push(...this.cutShort(index, matched));
          return out;
        }
        return [{ kind: "event", event: { type: "content_block_delta", index, delta: event.delta } }];
      }

      case "content_block_stop": {
        const index = this.indices.get(event.index);
        if (index === undefined) return [];
        const out: IrEvent[] = [];
        const tail = this.gates.get(index)?.flush();
        if (tail) {
          out.push({ kind: "event", event: { type: "content_block_delta", index, delta: { type: "text_delta", text: tail } } });
        }
        this.gates.delete(index);
        out.push({ kind: "event", event: { type: "content_block_stop", index } });
        return out;
      }

      case "message_delta": {
        if (event.delta.stop_reason === "tool_use") this.sawToolUse = true;
        return [
          {
            kind: "event",
            event: {
              type: "message_delta",
              delta: { stop_reason: event.delta.stop_reason, stop_sequence: event.delta.stop_sequence },
              usage: { output_tokens: event.usage?.output_tokens ?? 0 },
            },
          },
        ];
      }

      case "message_stop": {
        const out: IrEvent[] = [{ kind: "event", event: { type: "message_stop" } }];
        if (this.sawToolUse) {
          this.finished = true;
          // The `result` event carrying cost never arrives: waiting for it bills a turn.
          out.push({
            kind: "meta",
            patch: {
              numTurns: 1,
              warning:
                "Stopped at the tool call, so the CLI did not report a cost for this message.",
            },
          });
        }
        return out;
      }

      default:
        return [];
    }
  }

  private cutShort(index: number, matched: string): IrEvent[] {
    this.finished = true;
    this.gates.delete(index);
    return [
      { kind: "event", event: { type: "content_block_stop", index } },
      {
        kind: "event",
        event: {
          type: "message_delta",
          delta: { stop_reason: "stop_sequence", stop_sequence: matched },
          usage: { output_tokens: 0 },
        },
      },
      { kind: "event", event: { type: "message_stop" } },
    ];
  }

  /** Drops CLI-only fields and restores the caller's tool names. */
  private clean(block: ContentBlock): ContentBlock {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text, citations: null };
      case "thinking":
        return { type: "thinking", thinking: block.thinking, signature: block.signature };
      case "redacted_thinking":
        return { type: "redacted_thinking", data: block.data };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: originalToolName(block.name, this.context.plan),
          input: {},
          caller: { type: "direct" },
        };
      default:
        return block;
    }
  }
}

function isThinking(block: ContentBlock): boolean {
  return block.type === "thinking" || block.type === "redacted_thinking";
}

/** Returns once the translator is satisfied; the runner takes that as leave to kill the CLI. */
export async function* decode(
  lines: AsyncGenerator<unknown>,
  context: DecodeContext<ToolPlan>,
): AsyncGenerator<IrEvent> {
  const translator = new Translator(context);
  for await (const line of lines) {
    if (!isCliEvent(line)) continue;
    for (const event of translator.translate(line)) yield event;
    if (translator.finished) break;
  }
}
