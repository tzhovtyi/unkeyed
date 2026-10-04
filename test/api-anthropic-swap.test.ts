/** The swap, type-checked against the real SDK, which is a dev dependency only. */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { Message as SdkMessage, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { Unkeyed, NotImplementedError } from "../src/api/anthropic/index.js";
import { Unkeyed as SdkTypedUnkeyed, meta } from "../src/sdk.js";

const FAKE_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-claude-stream.mjs",
);

const options = { cliPath: FAKE_CLI, unsupported: "ignore" } as const;

test("the one-line swap compiles, and the call sites around it do not change", async () => {
  // The line a project actually edits; `ANTHROPIC_API_KEY` is unset under test.
  const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : new SdkTypedUnkeyed(options);

  // Everything below is ordinary SDK code, typed by the SDK, unmodified.
  const messages: MessageParam[] = [{ role: "user", content: "hello" }];
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages,
  });

  assert.equal(response.stop_reason, "end_turn");
  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  assert.equal(text, "echo: hello");
  assert.equal(response.usage.input_tokens, 120);
  assert.equal(response.container, null);

  // The cost is still there, behind a type that does not know about it.
  assert.equal(meta(response)?.costUsd, 0.0042);
});

test("a response satisfies code typed against the SDK's own Message", async () => {
  const response = await new Unkeyed(options).messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "hello" }],
  });

  // The assignment is the assertion: it compiles only if the shapes agree.
  const asSdkMessage: SdkMessage = response;
  assert.equal(asSdkMessage.role, "assistant");

  const summarise = (message: SdkMessage): string => `${message.model}/${message.stop_reason}`;
  assert.equal(summarise(response), "claude-haiku-fake/end_turn");
});

test("a streamed event satisfies the SDK's event union", async () => {
  const stream = await new Unkeyed(options).messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "hello" }],
    stream: true,
  });
  const seen: string[] = [];
  for await (const event of stream) {
    // Narrowed exactly as SDK consumers narrow it.
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      seen.push(event.delta.text);
    }
  }
  assert.equal(seen.join(""), "echo: hello");
});

test("accepts a params object built for the API, extra fields and all", async () => {
  const response = await new Unkeyed(options).beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    // Fields this package does not model must not be errors at the call site.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    metadata: { user_id: "u1" },
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  });
  assert.equal(response.type, "message");
});

test("names the namespaces it does not implement instead of failing obscurely", () => {
  const client = new Unkeyed(options);
  for (const reach of [
    () => client.completions,
    () => client.files,
    () => client.containers,
    () => client.messages.batches,
  ]) {
    assert.throws(reach, (error: unknown) => error instanceof NotImplementedError);
  }
});
