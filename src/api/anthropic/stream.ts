/** The streaming return values, shaped like the SDK's. */
import type { IrEvent } from "../../ir/index.js";
import { APIUserAbortError } from "./errors.js";
import { MessageAccumulator, assemble } from "./from-ir.js";
import type { ContentBlock, Message, MessageStreamEvent } from "./protocol.js";

/** Bridges an eagerly consumed source to `for await`: `.on()` listeners read immediately. */
class EventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiting: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private failure: { error: unknown } | null = null;

  push(item: T): void {
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    this.failure = { error };
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.failure) return Promise.reject(this.failure.error);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

export class UnkeyedStream implements AsyncIterable<MessageStreamEvent> {
  constructor(
    private readonly source: AsyncGenerator<IrEvent>,
    /** Aborts the CLI, mirroring the SDK's `stream.controller.abort()`. */
    readonly controller: AbortController,
    private readonly requestedModel: string,
    private readonly warnings: readonly string[],
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
    for await (const normalized of this.source) {
      if (normalized.kind === "event") yield normalized.event;
    }
  }

  finalMessage(): Promise<Message> {
    return assemble(this.source, this.requestedModel, this.warnings);
  }
}

export type MessageStreamEvents = {
  streamEvent: (event: MessageStreamEvent) => void;
  text: (delta: string, snapshot: string) => void;
  contentBlock: (block: ContentBlock) => void;
  message: (message: Message) => void;
  error: (error: unknown) => void;
  end: () => void;
  abort: (error: unknown) => void;
};

export class MessageStream implements AsyncIterable<MessageStreamEvent> {
  private readonly queue = new EventQueue<MessageStreamEvent>();
  private readonly listeners = new Map<keyof MessageStreamEvents, Array<(...args: never[]) => void>>();
  private readonly accumulator: MessageAccumulator;
  private readonly settled: Promise<Message>;
  private text = "";

  constructor(
    source: AsyncGenerator<IrEvent>,
    readonly controller: AbortController,
    requestedModel: string,
    warnings: readonly string[],
  ) {
    this.accumulator = new MessageAccumulator(requestedModel, warnings);
    // Not on first iteration: `.on()` and `.finalMessage()` never iterate.
    this.settled = this.consume(source);
    // An unobserved rejection would crash the process; listeners still see the error.
    this.settled.catch(() => {});
  }

  private async consume(source: AsyncGenerator<IrEvent>): Promise<Message> {
    try {
      for await (const normalized of source) {
        this.accumulator.push(normalized);
        if (normalized.kind !== "event") continue;
        const event = normalized.event;
        this.emit("streamEvent", event);
        this.queue.push(event);
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          this.text += event.delta.text;
          this.emit("text", event.delta.text, this.text);
        }
        if (event.type === "content_block_stop") {
          const block = this.accumulator.message().content[event.index];
          if (block) this.emit("contentBlock", block);
        }
      }
      const message = this.accumulator.message();
      this.emit("message", message);
      this.queue.end();
      this.emit("end");
      return message;
    } catch (error) {
      this.queue.fail(error);
      this.emit("error", error);
      if (error instanceof APIUserAbortError) this.emit("abort", error);
      this.emit("end");
      throw error;
    }
  }

  on<K extends keyof MessageStreamEvents>(event: K, listener: MessageStreamEvents[K]): this {
    const existing = this.listeners.get(event);
    if (existing) existing.push(listener as (...args: never[]) => void);
    else this.listeners.set(event, [listener as (...args: never[]) => void]);
    return this;
  }

  private emit<K extends keyof MessageStreamEvents>(
    event: K,
    ...args: Parameters<MessageStreamEvents[K]>
  ): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...values: Parameters<MessageStreamEvents[K]>) => void)(...args);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
    return { next: () => this.queue.next() };
  }

  finalMessage(): Promise<Message> {
    return this.settled;
  }

  async finalText(): Promise<string> {
    const message = await this.settled;
    return message.content
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  async done(): Promise<void> {
    await this.settled;
  }

  abort(): void {
    this.controller.abort();
  }
}
