import assert from "node:assert/strict";
import test from "node:test";
import { promptTokens } from "../src/cli/claude/usage.js";

test("counts cache reads and writes as prompt tokens", () => {
  assert.equal(
    promptTokens({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5 }),
    125,
  );
});

test("ignores output tokens", () => {
  assert.equal(promptTokens({ input_tokens: 10, output_tokens: 999 }), 10);
});

test("treats missing fields and a missing usage block as zero", () => {
  assert.equal(promptTokens({ input_tokens: 7 }), 7);
  assert.equal(promptTokens({}), 0);
  assert.equal(promptTokens(undefined), 0);
});
