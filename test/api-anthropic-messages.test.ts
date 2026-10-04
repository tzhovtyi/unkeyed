import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Unkeyed } from "../src/api/anthropic/index.js";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "../src/api/anthropic/errors.js";
import type { UnkeyedOptions } from "../src/api/anthropic/client.js";
import type { ContentBlock, Message, MessageCreateParams } from "../src/api/anthropic/protocol.js";

const FAKE_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-claude-stream.mjs",
);

/** A client wired to the fake binary, quiet unless a test asks for warnings. */
function client(options: UnkeyedOptions = {}) {
  return new Unkeyed({ cliPath: FAKE_CLI, unsupported: "ignore", ...options });
}

type NonStreaming = MessageCreateParams & { stream?: false };

function ask(prompt: string, extra: Partial<MessageCreateParams> = {}): NonStreaming {
  return {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
    ...extra,
    stream: false,
  };
}

/** The same request, asked for as a stream. */
function askStreaming(prompt: string): MessageCreateParams & { stream: true } {
  return { ...ask(prompt), stream: true };
}

/** The argv the fixture was invoked with, for asserting the flag set. */
async function argvFor(
  params: Partial<MessageCreateParams> = {},
  options: UnkeyedOptions = {},
): Promise<string[]> {
  const message = await client(options).messages.create(ask("MODE:args", params));
  return JSON.parse(textOf(message)) as string[];
}

function textOf(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Captures what the client printed, since warning once per client is the contract. */
async function captureWarnings(run: () => Promise<unknown>): Promise<string[]> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("returns a Message with the API's shape", async () => {
  const message = await client().messages.create(ask("hello"));
  assert.equal(message.type, "message");
  assert.equal(message.role, "assistant");
  assert.equal(message.id, "msg_fake001");
  assert.equal(message.model, "claude-haiku-fake");
  assert.equal(message.stop_reason, "end_turn");
  assert.equal(message.stop_sequence, null);
  assert.equal(textOf(message), "echo: hello");
  // Field for field with the API's usage block; what the CLI cannot report is null.
  assert.deepEqual(message.usage, {
    input_tokens: 120,
    output_tokens: 42,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 7,
    cache_creation: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    inference_geo: null,
  });
  assert.equal(message.container, null);
  assert.equal(message.stop_details, null);
});

test("reports what the call cost under _unkeyed", async () => {
  const message = await client().messages.create(ask("hello"));
  assert.equal(message._unkeyed.costUsd, 0.0042);
  assert.equal(message._unkeyed.durationMs, 1234);
  assert.equal(message._unkeyed.numTurns, 1);
  assert.deepEqual(message._unkeyed.warnings, []);
});

test("drops thinking the caller did not ask for, and renumbers what is left", async () => {
  const message = await client().messages.create(ask("hello"));
  assert.equal(message.content.length, 1);
  assert.equal(message.content[0]?.type, "text");
});

test("keeps thinking when the request enables it", async () => {
  const message = await client().messages.create(
    ask("hello", { thinking: { type: "enabled", budget_tokens: 2048 } }),
  );
  assert.deepEqual(
    message.content.map((block) => block.type),
    ["thinking", "text"],
  );
  const [thinking] = message.content;
  assert.equal(thinking?.type === "thinking" && thinking.thinking, "pondering");
  assert.equal(thinking?.type === "thinking" && thinking.signature, "sig-abc");
});

test("keeps thinking when the client overrides the request", async () => {
  const message = await client({ includeThinking: true }).messages.create(ask("hello"));
  assert.equal(message.content.length, 2);
});

// ── the invocation ──

test("pins the CLI to a hermetic, tool-less session", async () => {
  const argv = await argvFor();
  for (const flag of [
    "-p",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--include-partial-messages",
  ]) {
    assert.ok(argv.includes(flag), `expected ${flag}`);
  }
  assert.equal(argv[argv.indexOf("--tools") + 1], "");
  assert.equal(argv[argv.indexOf("--setting-sources") + 1], "");
  assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json");
  assert.equal(argv[argv.indexOf("--input-format") + 1], "stream-json");
});

test("passes the requested model through untouched", async () => {
  const argv = await argvFor();
  assert.equal(argv[argv.indexOf("--model") + 1], "claude-sonnet-5");
});

test("lets the client force a model or remap one", async () => {
  assert.equal(
    (await argvFor({}, { model: "haiku" }))[(await argvFor({}, { model: "haiku" })).indexOf("--model") + 1],
    "haiku",
  );
  const mapped = await argvFor({}, { modelMap: { "claude-sonnet-5": "sonnet" } });
  assert.equal(mapped[mapped.indexOf("--model") + 1], "sonnet");
});

test("replaces the CLI's own system prompt rather than inheriting it", async () => {
  const argv = await argvFor();
  assert.equal(argv[argv.indexOf("--system-prompt") + 1], "You are a helpful assistant.");
  const custom = await argvFor({ system: "Answer in Latin." });
  assert.equal(custom[custom.indexOf("--system-prompt") + 1], "Answer in Latin.");
  const blocks = await argvFor({ system: [{ type: "text", text: "A" }, { type: "text", text: "B" }] });
  assert.equal(blocks[blocks.indexOf("--system-prompt") + 1], "A\n\nB");
});

test("translates a thinking budget into an effort level", async () => {
  const cases: Array<[number, string]> = [
    [1024, "low"],
    [8000, "medium"],
    [16000, "high"],
    [32000, "xhigh"],
    [64000, "max"],
  ];
  for (const [budget, effort] of cases) {
    const argv = await argvFor({ thinking: { type: "enabled", budget_tokens: budget } });
    assert.equal(argv[argv.indexOf("--effort") + 1], effort, `budget ${budget}`);
  }
  assert.ok(!(await argvFor()).includes("--effort"));
});

test("runs in an empty directory so no project config is discovered", async () => {
  const message = await client().messages.create(ask("MODE:cwd"));
  assert.notEqual(textOf(message), process.cwd());
});

test("keeps an API key out of the CLI's environment", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-be-used";
  try {
    const message = await client({ env: { UNKEYED_EXTRA: "yes" } }).messages.create(ask("MODE:env"));
    assert.deepEqual(JSON.parse(textOf(message)), { key: null, extra: "yes" });
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// ── turning a conversation into one turn ──

test("sends a lone user message as its own content, unframed", async () => {
  const message = await client().messages.create(ask("MODE:input"));
  assert.deepEqual(JSON.parse(textOf(message)), [{ type: "text", text: "MODE:input" }]);
});

test("passes image blocks through as blocks, not as descriptions", async () => {
  const message = await client().messages.create(
    ask("unused", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "MODE:input" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(JSON.parse(textOf(message)), [
    { type: "text", text: "MODE:input" },
    { type: "image", media_type: "image/png", bytes: 8 },
  ]);
});

test("decodes a textual document inline", async () => {
  const message = await client().messages.create(
    ask("unused", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              title: "notes.md",
              source: {
                type: "base64",
                media_type: "text/plain",
                data: Buffer.from("codename thunderbird").toString("base64"),
              },
            },
            { type: "text", text: "MODE:input" },
          ],
        },
      ],
    }),
  );
  const [document] = JSON.parse(textOf(message)) as Array<{ text: string }>;
  assert.match(document?.text ?? "", /<document title="notes\.md">\ncodename thunderbird\n<\/document>/);
});

test("refuses a document it cannot read rather than answering without it", async () => {
  await assert.rejects(
    client().messages.create(
      ask("unused", {
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBER" } },
            ],
          },
        ],
      }),
    ),
    (error: unknown) => error instanceof BadRequestError && /application\/pdf/.test(error.message),
  );
});

test("omits an unreadable document when told to, and says so", async () => {
  const message = await client({ documents: "omit" }).messages.create(
    ask("unused", {
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "url", url: "https://example.com/a.pdf" } },
            { type: "text", text: "MODE:input" },
          ],
        },
      ],
    }),
  );
  assert.match(message._unkeyed.warnings.join(" "), /was omitted/);
});

test("flattens a multi-turn conversation into one labelled turn", async () => {
  const message = await client().messages.create(
    ask("unused", {
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "MODE:input" },
      ],
    }),
  );
  const sent = (JSON.parse(textOf(message)) as Array<{ text: string }>)[0]?.text ?? "";
  assert.match(sent, /<conversation>/);
  assert.match(sent, /<user>\nfirst\n<\/user>/);
  assert.match(sent, /<assistant>\nsecond\n<\/assistant>/);
});

test("warns that flattening happened", async () => {
  const lines = await captureWarnings(() =>
    client({ unsupported: "warn" }).messages.create(
      ask("unused", {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "second" },
          { role: "user", content: "last" },
        ],
      }),
    ),
  );
  assert.match(lines.join(" "), /flattened into a single turn/);
});

test("renders a tool result from a previous turn as text", async () => {
  const message = await client().messages.create(
    ask("unused", {
      messages: [
        { role: "user", content: "what is the weather" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "17C" },
            { type: "text", text: "MODE:input" },
          ],
        },
      ],
    }),
  );
  const sent = (JSON.parse(textOf(message)) as Array<{ text: string }>)[0]?.text ?? "";
  assert.match(sent, /<tool_use id="toolu_1" name="get_weather">/);
  assert.match(sent, /<tool_result tool_use_id="toolu_1">\n17C\n<\/tool_result>/);
});

// ── unsupported parameters ──

test("records ignored sampling parameters on the response", async () => {
  const message = await client({ unsupported: "warn" }).messages.create(
    ask("hello", { temperature: 0, top_p: 0.5 }),
  );
  assert.match(message._unkeyed.warnings.join(" "), /`temperature` is not supported/);
  assert.match(message._unkeyed.warnings.join(" "), /`top_p` is not supported/);
});

test("can be told to reject a request it cannot honour exactly", async () => {
  await assert.rejects(
    client({ unsupported: "throw" }).messages.create(ask("hello", { temperature: 0 })),
    (error: unknown) => error instanceof BadRequestError && /temperature/.test(error.message),
  );
});

// ── tools ──

test("returns a tool call under the caller's own tool name", async () => {
  const message = await client().messages.create(
    ask("MODE:tool", {
      tools: [
        { name: "get_weather", description: "weather", input_schema: { type: "object" } },
        { name: "other", input_schema: { type: "object" } },
      ],
    }),
  );
  assert.equal(message.stop_reason, "tool_use");
  assert.equal(message.content.length, 1);
  const [block] = message.content;
  assert.equal(block?.type, "tool_use");
  assert.equal(block?.type === "tool_use" && block.name, "get_weather");
  assert.deepEqual(block?.type === "tool_use" ? block.input : null, { city: "Paris" });
});

test("stops at the tool call instead of billing the CLI's next turn", async () => {
  const message = await client().messages.create(
    ask("MODE:tool", {
      tools: [
        { name: "get_weather", input_schema: { type: "object" } },
        { name: "other", input_schema: { type: "object" } },
      ],
    }),
  );
  // The fixture's second turn costs 0.9 and says "placeholder"; neither appears.
  assert.equal(message._unkeyed.numTurns, 1);
  assert.equal(message._unkeyed.costUsd, 0);
  assert.doesNotMatch(textOf(message), /placeholder/i);
  assert.match(message._unkeyed.warnings.join(" "), /did not report a cost/);
});

test("exposes bridged tools through an allow-list, not a permission bypass", async () => {
  const argv = await argvFor({
    tools: [
      { name: "get_weather", input_schema: { type: "object" } },
      { name: "other", input_schema: { type: "object" } },
    ],
  });
  assert.equal(argv[argv.indexOf("--allowedTools") + 1], "mcp__unkeyed__get_weather,mcp__unkeyed__other");
  assert.ok(argv.includes("--mcp-config"));
  assert.ok(!argv.includes("--dangerously-skip-permissions"));
});

test("drives a forced tool through structured output instead of a bridge", async () => {
  const schema = { type: "object", properties: { name: { type: "string" } } };
  const argv = await argvFor({
    tools: [{ name: "record_user", input_schema: schema }],
    tool_choice: { type: "tool", name: "record_user" },
  });
  assert.equal(argv[argv.indexOf("--json-schema") + 1], JSON.stringify(schema));
  assert.ok(!argv.includes("--mcp-config"));
});

test("renames the CLI's structured-output tool back to the caller's", async () => {
  const message = await client().messages.create(
    ask("MODE:schema", {
      tools: [{ name: "record_user", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "record_user" },
    }),
  );
  assert.equal(message.stop_reason, "tool_use");
  const [block] = message.content;
  assert.equal(block?.type === "tool_use" && block.name, "record_user");
  assert.deepEqual(block?.type === "tool_use" ? block.input : null, { name: "Ada", age: 36 });
});

test("treats a single `any` choice as forced, since it is determinate", async () => {
  const argv = await argvFor({
    tools: [{ name: "only", input_schema: { type: "object" } }],
    tool_choice: { type: "any" },
  });
  assert.ok(argv.includes("--json-schema"));
});

test("exposes no tools at all when tool_choice is none", async () => {
  const argv = await argvFor({
    tools: [{ name: "get_weather", input_schema: { type: "object" } }],
    tool_choice: { type: "none" },
  });
  assert.ok(!argv.includes("--mcp-config"));
  assert.ok(!argv.includes("--json-schema"));
});

test("reports unparseable tool arguments instead of inventing them", async () => {
  const message = await client().messages.create(
    ask("MODE:badjson", {
      tools: [{ name: "record_user", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "record_user" },
    }),
  );
  const [block] = message.content;
  assert.deepEqual(block?.type === "tool_use" ? block.input : null, {});
  assert.match(message._unkeyed.warnings.join(" "), /not valid JSON/);
});

test("rejects a tool_choice that names a tool that was not supplied", async () => {
  await assert.rejects(
    client().messages.create(
      ask("hello", {
        tools: [{ name: "a", input_schema: { type: "object" } }],
        tool_choice: { type: "tool", name: "missing" },
      }),
    ),
    (error: unknown) => error instanceof BadRequestError,
  );
});

// ── stop sequences ──

test("emulates stop sequences, including one split across deltas", async () => {
  const message = await client().messages.create(ask("MODE:stop", { stop_sequences: ["END"] }));
  assert.equal(textOf(message), "keep this then ");
  assert.equal(message.stop_reason, "stop_sequence");
  assert.equal(message.stop_sequence, "END");
});

test("leaves text alone when no stop sequence matches", async () => {
  const message = await client().messages.create(ask("MODE:stop", { stop_sequences: ["ZZZ"] }));
  assert.equal(textOf(message), "keep this then END and drop all of this");
  assert.equal(message.stop_reason, "end_turn");
});

// ── streaming ──

test("streams the API's own event sequence", async () => {
  const stream = await client().messages.create(askStreaming("hello"));
  const types: string[] = [];
  for await (const event of stream) types.push(event.type);
  // Two deltas: the fixture splits "echo: " from the prompt, as the API would.
  assert.deepEqual(types, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
});

test("numbers streamed blocks from zero after dropping thinking", async () => {
  const stream = await client().messages.create(askStreaming("hello"));
  for await (const event of stream) {
    if (event.type === "content_block_start") assert.equal(event.index, 0);
  }
});

test("collects a streamed message through the SDK's helper", async () => {
  const stream = await client().messages.stream(ask("hello"));
  const chunks: string[] = [];
  stream.on("text", (delta) => chunks.push(delta));
  const message = await stream.finalMessage();
  assert.equal(chunks.join(""), "echo: hello");
  assert.equal(await stream.finalText(), "echo: hello");
  assert.equal(message.stop_reason, "end_turn");
});

test("iterating the helper yields the same events the listeners saw", async () => {
  const stream = await client().messages.stream(ask("hello"));
  const seen: string[] = [];
  for await (const event of stream) seen.push(event.type);
  assert.deepEqual(seen[0], "message_start");
  assert.equal(seen.at(-1), "message_stop");
});

test("surfaces a failure to the helper's error listener and its promise", async () => {
  const stream = await client().messages.stream(ask("MODE:localerror"));
  const errors: unknown[] = [];
  stream.on("error", (error) => errors.push(error));
  await assert.rejects(stream.finalMessage(), (error: unknown) => error instanceof InternalServerError);
  assert.equal(errors.length, 1);
});

// ── failures ──

test("maps an exhausted subscription onto a 429", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:ratelimited")),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.status === 429 &&
      error.resetsAt === 1791050400 &&
      /five_hour/.test(error.message),
  );
});

test("maps an upstream status onto the error the API would have raised", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:apierror")),
    (error: unknown) =>
      error instanceof AuthenticationError &&
      error.status === 401 &&
      error.error.type === "authentication_error",
  );
});

test("reports a local CLI failure as a server error", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:localerror")),
    (error: unknown) => error instanceof InternalServerError && error.status === 500,
  );
});

test("explains how to sign in when that is the real problem", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:unauthenticated")),
    (error: unknown) => error instanceof AuthenticationError && /auth login/.test(error.message),
  );
});

test("reports a non-zero exit with the CLI's own complaint", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:exit")),
    (error: unknown) => error instanceof InternalServerError && /fake failure/.test(error.message),
  );
});

test("reports a missing binary as a connection failure", async () => {
  await assert.rejects(
    client({ cliPath: "/nonexistent/claude" }).messages.create(ask("hello")),
    (error: unknown) => error instanceof APIConnectionError && /claude\.com\/claude-code/.test(error.message),
  );
});

test("reports an empty stream rather than returning an empty message", async () => {
  await assert.rejects(
    client().messages.create(ask("MODE:silent")),
    (error: unknown) => error instanceof InternalServerError && /without producing a message/.test(error.message),
  );
});

test("skips unparseable output instead of failing on it", async () => {
  const message = await client().messages.create(ask("MODE:noise"));
  assert.equal(textOf(message), "survived");
});

test("times out as a connection timeout", async () => {
  await assert.rejects(
    client({ timeoutMs: 300 }).messages.create(ask("MODE:hang")),
    (error: unknown) => error instanceof APIConnectionTimeoutError,
  );
});

test("honours an abort signal", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    client().messages.create(ask("MODE:hang"), { signal: controller.signal }),
    (error: unknown) => error instanceof APIUserAbortError,
  );
});

test("honours a signal that was already aborted", async () => {
  await assert.rejects(
    client().messages.create(ask("hello"), { signal: AbortSignal.abort() }),
    (error: unknown) => error instanceof APIUserAbortError,
  );
});

test("rejects a request with no messages", async () => {
  await assert.rejects(
    client().messages.create({ model: "claude-sonnet-5", max_tokens: 10, messages: [] }),
    (error: unknown) => error instanceof BadRequestError,
  );
});

// ── the rest of the surface ──

test("answers through the beta namespace too", async () => {
  const message = await client().beta.messages.create(ask("hello"));
  assert.equal(textOf(message), "echo: hello");
});

test("estimates a token count and admits that it is an estimate", async () => {
  const count = await client().messages.countTokens({
    messages: [{ role: "user", content: "x".repeat(400) }],
  });
  assert.equal(count._estimated, true);
  assert.equal(count.input_tokens, 100);
});

test("lists models", async () => {
  const page = await client().models.list();
  assert.ok(page.data.some((model) => model.id === "claude-opus-5"));
  assert.equal(page.has_more, false);
  assert.equal((await client().models.retrieve("claude-opus-5")).display_name, "Claude Opus 5");
});

test("carries no API key", async () => {
  assert.equal(client().apiKey, null);
});
