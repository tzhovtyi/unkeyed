import type { ModelDescriptor } from "../../ir/index.js";

/** What `--model` accepts. Short aliases (`sonnet`, `haiku`) work too. */
export const MODELS: readonly ModelDescriptor[] = [
  { id: "claude-fable-5", displayName: "Claude Fable 5", createdAt: "2026-01-01T00:00:00Z" },
  { id: "claude-opus-5", displayName: "Claude Opus 5", createdAt: "2026-01-01T00:00:00Z" },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", createdAt: "2026-01-01T00:00:00Z" },
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", createdAt: "2025-10-01T00:00:00Z" },
];
