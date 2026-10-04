# Layout

Two independent axes, one shared vocabulary.

```
core/        process plumbing: spawn, error family, temp dirs. No provider knowledge.
ir/          the vocabulary the axes meet in: request, events, transcript flattening.
cli/         ← one directory per CLI.    adapter.ts is the contract, run.ts runs a call.
api/         ← one directory per API.    Each owns a protocol and nothing else.
simple/      the measured one-shot surface, generic over any CompletionAdapter.
index.ts     the package root: the Anthropic surface plus the error family.
sdk.ts       the same client wearing `@anthropic-ai/sdk`'s type.
```

The axes are the point. An API surface (`api/anthropic/`) does not know which
binary answers it; a CLI adapter (`cli/claude/`) does not know which API asked.
Adding one of either is a new directory rather than a change to the other side,
which keeps a 2×2 at four files instead of four implementations.

## The dependency rule

```
core/  →  (nothing)
ir/    →  (nothing)
cli/*  →  core, ir
api/*  →  core, ir, cli/adapter, cli/run   (+ one default adapter, named in client.ts)
simple →  core, ir, cli
```

Two directions are forbidden, and both matter:

- **`cli/` must not import `api/`.** The moment an adapter throws an
  API-shaped error or reads a protocol type, it only works for that one API.
  Adapters raise `core/errors.ts` failures; each surface maps them to its own
  (`api/anthropic/errors.ts`, `asApiError`).
- **`ir/` must not import either.** It is the contract, not a layer on top of
  one.

## Where a given decision lives

| Decision | Home | Why |
| --- | --- | --- |
| What `temperature` does when unsupported | `api/anthropic/to-ir.ts` | A parameter of that API |
| How a document block becomes prose | `api/anthropic/to-ir.ts` | A block type of that API |
| That history is flattened to one turn | `ir/transcript.ts` | True of every CLI, for every API |
| Which flag sets the model | `cli/claude/args.ts` | A flag of that binary |
| How tools are exposed at all | `cli/claude/tools.ts` | A capability of that binary |
| What an exhausted quota is called | `api/anthropic/errors.ts` | An HTTP status is an API's idea |
| Stop sequences, which nothing supports | `ir/stop-sequences.ts` | Emulated the same way everywhere |

## Adding a CLI

1. `cli/<name>/`: implement `CliAdapter` (`encode`, `decode`, identity,
   `models`) and, if the binary has a one-shot JSON mode, `CompletionAdapter`.
2. `simple/<name>.ts`: four lines, binding the completion adapter.
3. `package.json`: one `exports` entry for the one-shot client.
4. Tests as `test/cli-<name>-*.test.ts`, with a fake binary in `test/fixtures/`.

Nothing under `api/` changes: every surface takes the adapter as `{ cli }`.
`test/api-anthropic-adapter.test.ts` drives the Anthropic surface with an
invented CLI to keep that honest.

## Adding an API

1. `api/<name>/`: `protocol.ts` (its types), `to-ir.ts`, `from-ir.ts`,
   `client.ts`, and `errors.ts` mapping `CliError`s to its own.
2. `package.json`: one `exports` entry, plus a `/sdk` variant if that
   ecosystem has an SDK type worth wearing (see `sdk.ts` for why).

Nothing under `cli/` changes.

## Decisions worth knowing

- **The IR is the Anthropic event vocabulary**, not a third invented one
  (`ir/events.ts` says why). A non-Anthropic CLI decodes into it; a
  non-Anthropic surface translates out of it.
- **The adapter contract is internal.** Publishing it, so a third party could
  ship an adapter, is one `exports` entry away. Not taken yet, on purpose.
