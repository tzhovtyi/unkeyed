/** One turn, in terms every CLI can be asked for and no API owns. */

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Named levels rather than a token budget, because that is what the CLIs sell. */
export type Effort = (typeof EFFORT_LEVELS)[number];

/** Sent when a surface has none: leaving the flag off keeps the CLI's own agent prompt. */
export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

export type Base64Source = {
  type: "base64";
  media_type: string;
  data: string;
};

export type UrlSource = {
  type: "url";
  url: string;
};

export type TextSpan = { type: "text"; text: string };

/** Passed through as bytes. Text is the fallback for everything else. */
export type ImageSpan = { type: "image"; source: Base64Source | UrlSource };

export type PromptBlock = TextSpan | ImageSpan;

export type Turn = {
  /** The label the turn renders under: `user`, `assistant`, whatever the surface calls it. */
  role: string;
  blocks: PromptBlock[];
};

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  schema: Record<string, unknown>;
};

/** What the caller wants about tools, not how a CLI will achieve it. */
export type ToolIntent =
  | { kind: "none" }
  | { kind: "auto"; tools: ToolSpec[] }
  /** Resolved by the surface, where a name not in `tools` is still a bad request. */
  | { kind: "forced"; tools: ToolSpec[]; tool: ToolSpec };

export type Request = {
  /** Already mapped: whatever the surface resolved, the adapter passes through. */
  model: string;
  systemPrompt: string;
  /** The single user turn. History is flattened before it gets here. */
  prompt: PromptBlock[];
  effort?: Effort | undefined;
  tools: ToolIntent;
  /** Emulated by the decoder, since no CLI has a flag for it. */
  stopSequences: string[];
  includeThinking: boolean;
};
