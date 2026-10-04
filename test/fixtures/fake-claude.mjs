#!/usr/bin/env node
// A fake `claude --output-format json`; the prompt up to the first colon picks the mode.
import { readdirSync } from "node:fs";

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
const prompt = stdin.trim();

const envelope = (fields) => ({
  is_error: false,
  subtype: "success",
  duration_ms: 1234,
  total_cost_usd: 0.0042,
  permission_denials: [],
  usage: { input_tokens: 0, output_tokens: 0 },
  ...fields,
});

const write = (value) => process.stdout.write(JSON.stringify(value));

// The overhead probe. 200 prompt tokens is the baseline every other mode adds to.
if (prompt === "Reply with one word: ready") {
  write(envelope({ result: "ready", usage: { input_tokens: 150, cache_read_input_tokens: 50, output_tokens: 1 } }));
} else if (prompt === "MODE:args") {
  // Echo the argv we were invoked with so a test can assert the flag set.
  write(envelope({ result: JSON.stringify(process.argv.slice(2)), usage: { input_tokens: 200, output_tokens: 5 } }));
} else if (prompt === "MODE:cwd") {
  write(envelope({ result: JSON.stringify({ cwd: process.cwd(), entries: readdirSync(".") }), usage: { input_tokens: 200, output_tokens: 5 } }));
} else if (prompt === "MODE:cached") {
  // 200 overhead + 1000 of caller context, split across cache fields.
  write(envelope({ result: "cached answer", usage: { input_tokens: 400, cache_creation_input_tokens: 300, cache_read_input_tokens: 500, output_tokens: 20 } }));
} else if (prompt === "MODE:denials") {
  write(envelope({ result: "partial", permission_denials: [{ tool: "Read" }, { tool: "Bash" }], usage: { input_tokens: 200, output_tokens: 5 } }));
} else if (prompt === "MODE:is_error") {
  write(envelope({ is_error: true, subtype: "rate_limit", api_error_status: "429", result: "slow down" }));
} else if (prompt === "MODE:cheap_overhead") {
  // Prompt billed below the measured overhead, so contextTokens must clamp at 0.
  write(envelope({ result: "tiny", usage: { input_tokens: 10, output_tokens: 1 } }));
} else if (prompt === "MODE:no_usage") {
  write({ is_error: false, result: "bare" });
} else if (prompt === "MODE:garbage") {
  process.stdout.write("this is not json");
} else if (prompt === "MODE:exit") {
  process.stderr.write("fake failure\n");
  process.exit(3);
} else if (prompt === "MODE:hang") {
  // A pending timer, not an unsettled await: Node exits 13 on the latter.
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else {
  write(envelope({ result: `echo: ${prompt}`, usage: { input_tokens: 1200, output_tokens: 42 } }));
}
