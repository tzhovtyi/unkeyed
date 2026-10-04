# unkeyed

**Run code that makes Claude API calls without an API key, using your Claude subscription
instead.**

If you have Claude Code installed and signed in, you have everything you need to
run the call. `unkeyed` implements the [Anthropic Messages API](https://docs.claude.com/en/api/messages) and answers it by spawning your local `claude` binary instead of making an HTTP request. Code written against `@anthropic-ai/sdk` works unchanged: you swap the constructor and nothing else.

That makes a few things possible that a key would otherwise gate:

- **Run and test a project without provisioning a key.** A contributor with a
  Claude subscription but no billing account can still run the suite, and CI
  with a key set behaves exactly as before.
- **Script against your subscription** instead of metered API spend.
- **See what a prompt actually cost.** Responses carry what the vendor billed:
  tokens, cache reads and writes, dollars, rather than a tokenizer's guess.

Zero runtime dependencies.

> **Status: v0.1.0, not published to npm.** The API may still move.

## Requirements

|                              |                                                                           |
| ---------------------------- | ------------------------------------------------------------------------- |
| **Node.js**                  | 20.19 or newer                                                            |
| **Claude Code**              | the `claude` binary on `PATH` ([install](https://claude.com/claude-code)) |
| **A signed-in subscription** | `claude auth login`, verified with `claude auth status`                   |

No API key, and none is used: `ANTHROPIC_API_KEY` is stripped from the CLI's
environment so a stray key cannot silently bill the API instead.

## Install

Not on npm yet:

```bash
# from a local clone
git clone https://github.com/<your-username>/unkeyed && cd unkeyed
npm install && npm run build

# then, from your project
npm install /path/to/unkeyed
```

## Use it

### 1. As a drop-in for `@anthropic-ai/sdk`

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Unkeyed } from "unkeyed/sdk";

// With a key, the real API. Without one, your CLI subscription.
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : new Unkeyed();

// No need to change anything.
const response = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Say you are self-aware" }],
});
```

Use `unkeyed/sdk` for that ternary. It types the constructor as the SDK's
`Anthropic`, which keeps every existing call site compiling. Without the SDK
installed, import from `unkeyed` and use the client on its own terms:

```ts
import { Unkeyed } from "unkeyed";

const client = new Unkeyed({ model: "haiku" });
```

Streaming, tools and the SDK helper all work:

```ts
const stream = client.messages.stream({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Count to five." }],
});

stream.on("text", (chunk) => process.stdout.write(chunk));
await stream.finalMessage();
```

What a call cost rides along on the response:

```ts
import { meta } from "unkeyed/sdk"; // or `response._unkeyed` when typed by unkeyed

meta(response)?.costUsd; // what the CLI actually billed
meta(response)?.warnings; // ignored parameters, degraded translations
```

### 2. As a measured one-shot call

This one is not an API emulation. It is a single hermetic completion, and the
accounting is the reason to use it.

```ts
import { createClaude } from "unkeyed/claude";

const claude = createClaude({
  model: "claude-sonnet-5",
  effort: "low",
  systemPrompt: "Answer strictly from the supplied material.",
});

const { answer, contextTokens, costUsd } = await claude.complete(prompt);
```

`contextTokens` is the billed prompt minus the CLI's own harness overhead, so it
describes _your_ prompt rather than the vendor's wrapper.

Calls run with no tools, in a fresh temp directory, with no project
instructions, settings, MCP servers or session history, so the numbers describe
the prompt you sent and nothing else.

## Entry points

| Import           | Gives you                                                          |
| ---------------- | ------------------------------------------------------------------ |
| `unkeyed`        | `Unkeyed`, the errors, the types: the whole drop-in, no SDK needed |
| `unkeyed/sdk`    | the same `Unkeyed` typed as `Anthropic`, plus `meta()`             |
| `unkeyed/claude` | `createClaude()`, the measured call                                |

## Differences from the real API

The CLI is not the API, and the gaps are worth knowing before you trust a
number. Every degraded translation is also reported on the response under
`_unkeyed.warnings`, and printed once per client. Set `unsupported: "throw"` in a
test suite to turn each approximation into a failure.

### Parameters the CLI has no equivalent for

| Parameter                                      | What happens                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `max_tokens`                                   | Ignored, because the CLI has no output cap, so an answer can exceed it. Silent rather than warned, since the API requires the field. |
| `temperature`, `top_p`, `top_k`                | Ignored, with a warning. The CLI exposes no sampling controls.                                                                       |
| `stop_sequences`                               | Emulated: output is truncated at the first match, `stop_reason` becomes `stop_sequence`.                                             |
| `thinking`                                     | Mapped onto the CLI's `--effort`: ≤4k → `low`, ≤10k → `medium`, ≤24k → `high`, ≤48k → `xhigh`, above → `max`.                        |
| `service_tier`, `container`, server-side tools | Not supported.                                                                                                                       |
| `apiKey`, `baseURL`, `maxRetries`              | Accepted and ignored, so the swap point is not a type error.                                                                         |

### Behavioural differences

|                                      |                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations collapse to one turn   | The CLI answers _every_ user turn it is handed and ignores injected assistant turns, so replaying a transcript would bill each historical message. `messages` is flattened into a single user turn, with prior turns rendered as a labelled `<conversation>` block. Image blocks still go through as real blocks. |
| Usage includes CLI overhead          | `usage` is what the CLI billed: your prompt plus ~200 tokens of harness you cannot suppress. Negligible for a large prompt, most of the bill for a tiny one.                                                                                                                                                      |
| `countTokens` is an estimate         | The CLI has no counting endpoint. Approximated at ~4 chars/token and flagged with `_estimated: true`.                                                                                                                                                                                                             |
| Thinking blocks are dropped          | The CLI thinks whether you asked or not, while the API only returns reasoning when `thinking` is on. Pass `includeThinking: true` to keep them regardless.                                                                                                                                                        |
| PDF and URL documents throw          | There is no server-side extraction to borrow. Textual documents are decoded and inlined; a PDF raises `BadRequestError` rather than being silently dropped. `documents: "omit"` downgrades that to a warning.                                                                                                     |
| A tool call costs `0`                | Model-chosen tools go through a scoped MCP bridge. The read ends at the tool-use turn and the CLI is killed, so the cost report never arrives. Token counts still come from the stream.                                                                                                                           |
| Errors are shaped, not inherited     | Same `status`, `error.type` and `name` as the SDK raises, but `err instanceof Anthropic.APIError` cannot be true. Branch on the data.                                                                                                                                                                             |
| No default system prompt inheritance | A request without `system` gets `"You are a helpful assistant."` rather than Claude Code's multi-thousand-token agent prompt. Override with `defaultSystemPrompt`.                                                                                                                                                |

Batches, Files, Containers and the legacy Completions API are not implemented;
touching one throws a `NotImplementedError` that names it.

[`docs/reference.md`](docs/reference.md) has the full reference: every option,
every error class, the streaming contract and the provider-extension layout.

## Caveats

- **This is not an agent framework.** One shot, no tools, accounted for. For
  agents on your own infrastructure use the official
  [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which is Claude
  Code as a library with its tools and loop intact.
- **Rate limits are your subscription's**, not an API tier's. A `RateLimitError`
  carries `resetsAt`.
- **Latency is process-spawn latency.** Every call starts a CLI.

## Development

```bash
npm run typecheck
npm test            # no CLI install needed; runs against fake binary fixtures
npm run build
```

The suite drives stand-in binaries in `test/fixtures/` that print the same
envelopes and `stream-json` event sequences as the real CLI, so the spawn,
parse, translation, streaming, tool and accounting paths are all covered
without spending anything. `src/README.md` maps the architecture if you want to
add a provider.

## Disclaimer

Driving a subscription CLI programmatically is not the same thing as holding an
API key. **Check your own plan's terms, usage policies and rate-limit rules
before you rely on this.** Whether this kind of use is permitted for your
account is between you and the provider, those terms can change at any time,
and a provider may restrict or disallow it — possibly without notice, and
possibly with consequences for your account.

`unkeyed` only invokes a CLI you already installed and authenticated yourself.
It does not circumvent authentication, bypass rate limits, or access anything
your own login does not already grant. Even so, it is offered for local
development, testing and personal scripting, and the responsibility for
compliant use is yours. No warranty, express or implied — see the license.

## License

MIT
