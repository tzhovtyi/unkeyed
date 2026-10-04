import assert from "node:assert/strict";
import test from "node:test";
import { completionArgs } from "../src/cli/claude/args.js";

function pairFor(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

test("asks for the JSON envelope in print mode", () => {
  const args = completionArgs({ tools: [] });
  assert.ok(args.includes("-p"));
  assert.equal(pairFor(args, "--output-format"), "json");
});

test("passes an empty tool list, so no tools are available by default", () => {
  assert.equal(pairFor(completionArgs({ tools: [] }), "--tools"), "");
});

test("keeps the call sealed off from the host environment", () => {
  const args = completionArgs({ tools: [] });
  for (const flag of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(pairFor(args, "--setting-sources"), "");
});

test("omits optional flags rather than guessing a default", () => {
  const args = completionArgs({ tools: [] });
  assert.ok(!args.includes("--model"));
  assert.ok(!args.includes("--effort"));
  assert.ok(!args.includes("--system-prompt"));
});

test("forwards model, effort and system prompt when given", () => {
  const args = completionArgs({
    tools: [],
    model: "claude-sonnet-5",
    effort: "high",
    systemPrompt: "be terse",
  });
  assert.equal(pairFor(args, "--model"), "claude-sonnet-5");
  assert.equal(pairFor(args, "--effort"), "high");
  assert.equal(pairFor(args, "--system-prompt"), "be terse");
});

test("joins an explicit tool list", () => {
  assert.equal(pairFor(completionArgs({ tools: ["Read", "Grep"] }), "--tools"), "Read,Grep");
});

test("an empty system prompt is still passed, since it is a deliberate override", () => {
  assert.equal(pairFor(completionArgs({ tools: [], systemPrompt: "" }), "--system-prompt"), "");
});
