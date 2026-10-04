/** The Anthropic surface, answered by a CLI that is not Claude Code. */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Unkeyed } from "../src/api/anthropic/index.js";
import type { CliAdapter } from "../src/cli/adapter.js";
import { emptyMeta, emptyUsage, type IrEvent } from "../src/ir/index.js";
import type { ContentBlock, Message } from "../src/api/anthropic/protocol.js";

const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");

/** The fixture's own event shapes, which are nothing like Claude Code's. */
type CodexLine =
  | { t: "begin"; model: string }
  | { t: "text"; chunk: string }
  | { t: "end"; reason: string; cents: number; ms: number };

/** A complete adapter for an unsupported CLI: IR in, IR events out, no API mentioned. */
const codexish: CliAdapter<null> = {
  id: "codexish",
  defaultBinary: FAKE_CLI,
  notFoundHint: "this CLI is imaginary; that is the point",
  strippedEnv: ["OPENAI_API_KEY"],
  models: [{ id: "codex-mini", displayName: "Codex Mini", createdAt: "2026-02-02T00:00:00Z" }],

  async encode(request) {
    return {
      args: ["--pretend", "--model", request.model, "--prompt-from-stdin"],
      stdin: request.prompt.map((block) => (block.type === "text" ? block.text : "[image]")).join(""),
      plan: null,
      warnings: [],
    };
  },

  async *decode(lines, context): AsyncGenerator<IrEvent> {
    let started = false;
    for await (const line of lines) {
      const event = line as CodexLine;
      if (event.t === "begin") {
        yield { kind: "meta", patch: { model: event.model } };
        yield {
          kind: "event",
          event: {
            type: "message_start",
            message: {
              id: "msg_codex",
              type: "message",
              role: "assistant",
              model: event.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: emptyUsage(),
              container: null,
              diagnostics: null,
              stop_details: null,
              _unkeyed: emptyMeta(context.warnings),
            },
          },
        };
      } else if (event.t === "text") {
        if (!started) {
          started = true;
          yield {
            kind: "event",
            event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
          };
        }
        yield {
          kind: "event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: event.chunk } },
        };
      } else {
        yield { kind: "event", event: { type: "content_block_stop", index: 0 } };
        yield {
          kind: "event",
          event: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 11 },
          },
        };
        yield { kind: "event", event: { type: "message_stop" } };
        yield {
          kind: "meta",
          patch: { costUsd: event.cents / 100, durationMs: event.ms, numTurns: 1 },
        };
        return;
      }
    }
  },
};

function client() {
  return new Unkeyed({ cli: codexish, unsupported: "ignore" });
}

function textOf(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const ask = { model: "claude-sonnet-5", max_tokens: 16, messages: [{ role: "user" as const, content: "hello" }] };

test("answers the Messages API through an adapter for a different CLI", async () => {
  const message = await client().messages.create({ ...ask, stream: false });
  assert.equal(textOf(message), "codex says hello");
  assert.equal(message.model, "codex-mini");
  assert.equal(message.stop_reason, "end_turn");
  assert.equal(message.usage.output_tokens, 11);
  assert.equal(message._unkeyed.costUsd, 0.02);
  assert.equal(message._unkeyed.durationMs, 7);
});

test("streams through the same adapter", async () => {
  const stream = await client().messages.stream(ask);
  assert.equal(await stream.finalText(), "codex says hello");
});

test("runs the binary the adapter named, with the flags the adapter chose", async () => {
  const message = await client().messages.create({
    ...ask,
    messages: [{ role: "user", content: "MODE:args" }],
    stream: false,
  });
  const argv = JSON.parse(textOf(message)) as string[];
  assert.deepEqual(argv, ["--pretend", "--model", "claude-sonnet-5", "--prompt-from-stdin"]);
});

test("reports the adapter's identity and models, not Claude Code's", async () => {
  const instance = client();
  assert.equal(instance.baseURL, "cli://codexish");
  const page = await instance.models.list();
  assert.deepEqual(
    page.data.map((model) => model.id),
    ["codex-mini"],
  );
});

test("shares the conversation flattening every CLI needs", async () => {
  const message = await client().messages.create({
    ...ask,
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ],
    stream: false,
  });
  // The fixture echoes its prompt, so the framing the IR applied is visible.
  assert.match(textOf(message), /<conversation>/);
  assert.match(textOf(message), /<assistant>\nsecond\n<\/assistant>/);
});
