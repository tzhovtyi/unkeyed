import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaude } from "../src/simple/claude.js";
import {
  CliExitError,
  CliNotFoundError,
  CliParseError,
  CliResponseError,
  CliTimeoutError,
} from "../src/core/errors.js";

const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-claude.mjs");

/** A client wired to the fake binary. The fixture bills 200 prompt tokens for the probe. */
function client(options: Parameters<typeof createClaude>[0] = {}) {
  return createClaude({ cliPath: FAKE_CLI, ...options });
}

test("measures harness overhead once and reuses it", async () => {
  const claude = client();
  assert.equal(await claude.overheadTokens(), 200);
  assert.equal(await claude.overheadTokens(), 200);
});

test("reports context tokens with the overhead subtracted", async () => {
  const completion = await client().complete("hello");
  assert.equal(completion.promptTokens, 1200);
  assert.equal(completion.overheadTokens, 200);
  assert.equal(completion.contextTokens, 1000);
  assert.equal(completion.outputTokens, 42);
});

test("counts cache reads and writes toward the billed prompt", async () => {
  const completion = await client().complete("MODE:cached");
  assert.equal(completion.promptTokens, 1200);
  assert.equal(completion.contextTokens, 1000);
});

test("clamps context tokens at zero rather than reporting a negative", async () => {
  const completion = await client().complete("MODE:cheap_overhead");
  assert.equal(completion.promptTokens, 10);
  assert.equal(completion.contextTokens, 0);
});

test("skips the probe when the overhead is already known", async () => {
  const claude = client({ overheadTokens: 500 });
  assert.equal(await claude.overheadTokens(), 500);
  const completion = await claude.complete("hello");
  assert.equal(completion.contextTokens, 700);
});

test("returns the trimmed answer, cost and latency", async () => {
  const completion = await client().complete("hello");
  assert.equal(completion.answer, "echo: hello");
  assert.equal(completion.costUsd, 0.0042);
  assert.equal(completion.latencyMs, 1234);
  assert.deepEqual(completion.warnings, []);
});

test("exposes the raw envelope for unmodelled fields", async () => {
  const completion = await client().complete("hello");
  assert.equal(completion.raw.subtype, "success");
});

test("defaults every absent number to zero instead of NaN", async () => {
  const completion = await client({ overheadTokens: 0 }).complete("MODE:no_usage");
  assert.equal(completion.promptTokens, 0);
  assert.equal(completion.outputTokens, 0);
  assert.equal(completion.costUsd, 0);
  assert.ok(Number.isFinite(completion.latencyMs));
});

test("warns when the model tried to use a tool it does not have", async () => {
  const completion = await client().complete("MODE:denials");
  assert.equal(completion.warnings.length, 1);
  assert.match(completion.warnings[0] ?? "", /2 time\(s\)/);
});

test("runs with no tools and nothing inherited from the host", async () => {
  const completion = await client({ model: "claude-sonnet-5" }).complete("MODE:args");
  const args = JSON.parse(completion.answer) as string[];
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "");
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
});

test("runs in an empty directory, so no project instructions are discovered", async () => {
  const completion = await client().complete("MODE:cwd");
  const { cwd, entries } = JSON.parse(completion.answer) as { cwd: string; entries: string[] };
  assert.deepEqual(entries, []);
  assert.notEqual(path.resolve(cwd), process.cwd());
});

test("honours an explicit working directory", async () => {
  const completion = await client({ cwd: process.cwd() }).complete("MODE:cwd");
  const { cwd } = JSON.parse(completion.answer) as { cwd: string };
  assert.equal(path.resolve(cwd), process.cwd());
});

test("surfaces an error envelope as CliResponseError with its details", async () => {
  await assert.rejects(client().complete("MODE:is_error"), (error: unknown) => {
    assert.ok(error instanceof CliResponseError);
    assert.equal(error.details.subtype, "rate_limit");
    assert.equal(error.details.apiErrorStatus, "429");
    assert.match(error.message, /slow down/);
    return true;
  });
});

test("surfaces unparseable output as CliParseError", async () => {
  await assert.rejects(client().complete("MODE:garbage"), CliParseError);
});

test("surfaces a non-zero exit as CliExitError carrying stderr", async () => {
  await assert.rejects(client().complete("MODE:exit"), (error: unknown) => {
    assert.ok(error instanceof CliExitError);
    assert.equal(error.exitCode, 3);
    assert.match(error.stderr, /fake failure/);
    return true;
  });
});

test("kills a call that overruns its timeout", async () => {
  await assert.rejects(
    client({ timeoutMs: 150, overheadTokens: 0 }).complete("MODE:hang"),
    CliTimeoutError,
  );
});

test("explains how to install the CLI when the binary is missing", async () => {
  await assert.rejects(
    createClaude({ cliPath: "/nonexistent/claude-binary" }).complete("hello"),
    (error: unknown) => {
      assert.ok(error instanceof CliNotFoundError);
      assert.match(error.message, /claude-code/);
      return true;
    },
  );
});

test("a failed probe is not cached, so a later call can still succeed", async () => {
  const claude = createClaude({ cliPath: "/nonexistent/claude-binary" });
  await assert.rejects(claude.overheadTokens(), CliNotFoundError);
  await assert.rejects(claude.overheadTokens(), CliNotFoundError);
});
