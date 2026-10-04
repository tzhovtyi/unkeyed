#!/usr/bin/env node
// A fake `claude --output-format stream-json`, noise included; the first text block picks the mode.
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;

const input = JSON.parse(stdin.trim().split("\n")[0] ?? "{}");
const blocks = input.message?.content ?? [];
const prompt = blocks
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("\n");

// Searched for, not matched at the start: a flattened conversation wraps the text.
const mode = (/MODE:(\w+)/.exec(prompt) ?? [])[1] ?? "";

const SESSION = "11111111-2222-3333-4444-555555555555";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const wrap = (event) => emit({ type: "stream_event", event, session_id: SESSION, parent_tool_use_id: null });

const USAGE = {
  input_tokens: 120,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 7,
  output_tokens: 1,
};

function start(id = "msg_fake001") {
  emit({ type: "system", subtype: "init", session_id: SESSION, model: "claude-haiku-fake", tools: [] });
  emit({ type: "system", subtype: "status", status: "requesting", session_id: SESSION });
  wrap({
    type: "message_start",
    message: {
      model: "claude-haiku-fake",
      id,
      type: "message",
      role: "assistant",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE,
    },
  });
  emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1791050400 }, session_id: SESSION });
}

/** The CLI thinks whether or not anyone asked, which is why filtering matters. */
function thinking(index, text = "pondering") {
  wrap({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
  emit({ type: "system", subtype: "thinking_tokens", estimated_tokens: 5, session_id: SESSION });
  wrap({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: text, estimated_tokens: null } });
  wrap({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig-abc" } });
  wrap({ type: "content_block_stop", index });
}

function text(index, chunks) {
  wrap({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
  for (const chunk of chunks) {
    wrap({ type: "content_block_delta", index, delta: { type: "text_delta", text: chunk } });
  }
  wrap({ type: "content_block_stop", index });
}

function toolUse(index, name, json) {
  wrap({
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id: "toolu_fake001", name, input: {}, caller: { type: "direct" } },
  });
  for (const chunk of json) {
    wrap({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: chunk } });
  }
  wrap({ type: "content_block_stop", index });
}

function finish(stopReason, outputTokens = 42) {
  wrap({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null },
    usage: { ...USAGE, output_tokens: outputTokens },
  });
  wrap({ type: "message_stop" });
}

function result(fields = {}) {
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    duration_ms: 1234,
    total_cost_usd: 0.0042,
    session_id: SESSION,
    stop_reason: "end_turn",
    usage: { ...USAGE, output_tokens: 42 },
    ...fields,
  });
}

/** Images keep their bytes; everything else is reported as text. */
const describeInput = () =>
  JSON.stringify(
    blocks.map((block) =>
      block.type === "image"
        ? { type: "image", media_type: block.source.media_type, bytes: block.source.data.length }
        : { type: block.type, text: block.text },
    ),
  );

if (mode === "args") {
  start();
  thinking(0);
  text(1, [JSON.stringify(process.argv.slice(2))]);
  finish("end_turn");
  result();
} else if (mode === "input") {
  start();
  text(0, [describeInput()]);
  finish("end_turn");
  result();
} else if (mode === "cwd") {
  start();
  text(0, [process.cwd()]);
  finish("end_turn");
  result();
} else if (mode === "env") {
  start();
  text(0, [JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, extra: process.env.UNKEYED_EXTRA ?? null })]);
  finish("end_turn");
  result();
} else if (mode === "tool") {
  // A tool turn, then the placeholder round-trip the client must never surface.
  start();
  thinking(0);
  toolUse(1, "mcp__unkeyed__get_weather", ['{"city"', ': "Paris"}']);
  finish("tool_use");
  emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_fake001", content: "PLACEHOLDER" }] }, session_id: SESSION });
  start("msg_fake002");
  text(0, ["The tool returned a placeholder, so I cannot say."]);
  finish("end_turn");
  result({ num_turns: 2, total_cost_usd: 0.9 });
} else if (mode === "schema") {
  start();
  toolUse(0, "StructuredOutput", ['{"name": "Ada"', ', "age": 36}']);
  finish("tool_use");
  result({ stop_reason: "tool_use" });
} else if (mode === "badjson") {
  start();
  toolUse(0, "StructuredOutput", ["{not json"]);
  finish("tool_use");
  result({ stop_reason: "tool_use" });
} else if (mode === "stop") {
  // The stop sequence "END" straddles two deltas.
  start();
  text(0, ["keep this ", "then E", "ND and drop all of this"]);
  finish("end_turn");
  result();
} else if (mode === "ratelimited") {
  emit({ type: "system", subtype: "init", session_id: SESSION });
  emit({
    type: "rate_limit_event",
    rate_limit_info: { status: "rate_limited", rateLimitType: "five_hour", resetsAt: 1791050400, message: "five_hour limit reached" },
    session_id: SESSION,
  });
} else if (mode === "apierror") {
  start();
  emit({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: "401", result: "invalid bearer token", session_id: SESSION });
} else if (mode === "localerror") {
  start();
  emit({ type: "result", subtype: "error_max_turns", is_error: true, result: "gave up", session_id: SESSION });
} else if (mode === "silent") {
  emit({ type: "system", subtype: "init", session_id: SESSION });
} else if (mode === "noise") {
  // Non-JSON interleaved with real events: skipped, not fatal.
  process.stdout.write("Warning: something unparseable\n");
  start();
  text(0, ["survived"]);
  finish("end_turn");
  result();
} else if (mode === "unauthenticated") {
  process.stderr.write("Invalid API key · Please run /login\n");
  process.exit(1);
} else if (mode === "exit") {
  process.stderr.write("fake failure\n");
  process.exit(3);
} else if (mode === "hang") {
  start();
  text(0, ["partial"]);
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else {
  start();
  thinking(0);
  text(1, ["echo: ", prompt]);
  finish("end_turn");
  result();
}
