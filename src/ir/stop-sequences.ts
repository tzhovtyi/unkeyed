/** `stop_sequences`, emulated: each chunk's tail is held so a split match still matches. */
export class StopSequenceGate {
  private held = "";
  private readonly maxHold: number;

  constructor(private readonly sequences: readonly string[]) {
    this.maxHold = Math.max(0, ...sequences.map((sequence) => sequence.length - 1));
  }

  push(chunk: string): { text: string; matched: string | null } {
    const buffer = this.held + chunk;
    let at = -1;
    let matched: string | null = null;
    for (const sequence of this.sequences) {
      const found = buffer.indexOf(sequence);
      if (found !== -1 && (at === -1 || found < at)) {
        at = found;
        matched = sequence;
      }
    }
    if (matched !== null) {
      this.held = "";
      return { text: buffer.slice(0, at), matched };
    }
    const keep = Math.min(this.maxHold, buffer.length);
    this.held = buffer.slice(buffer.length - keep);
    return { text: buffer.slice(0, buffer.length - keep), matched: null };
  }

  flush(): string {
    const text = this.held;
    this.held = "";
    return text;
  }
}
