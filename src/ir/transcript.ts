/** One flattened turn: a CLI would bill and answer every turn of a replayed transcript. */
import type { PromptBlock, ImageSpan, Turn } from "./request.js";

export const DEFAULT_PREAMBLE =
  "Below is a conversation. Continue it: reply as the assistant to the final user turn.";

/** Text accumulates until an image interrupts it, so ordering survives. */
export class BlockWriter {
  private readonly pending: string[] = [];
  private readonly blocks: PromptBlock[] = [];

  text(value: string): void {
    this.pending.push(value);
  }

  image(block: ImageSpan): void {
    this.flush();
    this.blocks.push(block);
  }

  private flush(): void {
    const text = this.pending.join("");
    this.pending.length = 0;
    if (text.trim().length > 0) this.blocks.push({ type: "text", text });
  }

  done(): PromptBlock[] {
    this.flush();
    return this.blocks;
  }
}

export type FlattenResult = {
  prompt: PromptBlock[];
  /** Whether the turns were wrapped in a transcript, and so worth warning about. */
  framed: boolean;
};

/** One user turn passes through; framing it would add words the caller did not write. */
export function flatten(
  turns: readonly Turn[],
  options: { preamble?: string | undefined } = {},
): FlattenResult {
  const writer = new BlockWriter();
  const only = turns.length === 1 ? turns[0] : undefined;

  if (only && only.role === "user") {
    for (const block of only.blocks) write(writer, block);
    return { prompt: writer.done(), framed: false };
  }

  writer.text(`${options.preamble ?? DEFAULT_PREAMBLE}\n\n<conversation>\n`);
  for (const turn of turns) {
    writer.text(`<${turn.role}>\n`);
    for (const block of turn.blocks) write(writer, block);
    writer.text(`\n</${turn.role}>\n`);
  }
  writer.text("</conversation>");
  return { prompt: writer.done(), framed: true };
}

function write(writer: BlockWriter, block: PromptBlock): void {
  if (block.type === "image") writer.image(block);
  else writer.text(block.text);
}
