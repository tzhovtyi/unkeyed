/** Base for every failure this package raises, so one catch clause covers them all. */
export class CliError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliError";
  }
}

/** The binary is not where we were told to look. */
export class CliNotFoundError extends CliError {
  constructor(
    readonly command: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CliNotFoundError";
  }
}

export class CliTimeoutError extends CliError {
  constructor(
    readonly command: string,
    readonly timeoutMs: number,
  ) {
    super(`${command} did not answer within ${timeoutMs} ms`);
    this.name = "CliTimeoutError";
  }
}

export class CliExitError extends CliError {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    // Plain string, not NodeJS.Signals: a .d.ts must not require @types/node.
    readonly signal: string | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(
      `${command} exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}: ` +
        (stderr.trim() || stdout.trim() || "no output"),
    );
    this.name = "CliExitError";
  }
}

/** The process succeeded but did not print the JSON envelope we asked for. */
export class CliParseError extends CliError {
  constructor(
    readonly command: string,
    readonly stdout: string,
    options?: { cause?: unknown },
  ) {
    super(`could not parse JSON from ${command}: ${stdout.slice(0, 500)}`, options);
    this.name = "CliParseError";
  }
}

/** The CLI reported a failure inside an otherwise well-formed envelope. */
export class CliResponseError extends CliError {
  constructor(
    message: string,
    readonly details: { subtype?: string | undefined; apiErrorStatus?: string | null | undefined },
  ) {
    super(message);
    this.name = "CliResponseError";
  }
}

/** Out of quota: the one failure a caller can act on by waiting. */
export class CliRateLimitError extends CliError {
  constructor(
    message: string,
    readonly details: {
      /** Unix seconds, when the CLI reports it. */
      resetsAt?: number | undefined;
      /** The CLI's own name for the window: `five_hour`, `weekly`. */
      rateLimitType?: string | undefined;
    } = {},
  ) {
    super(message);
    this.name = "CliRateLimitError";
  }
}

/** The process ran and exited cleanly, but never said anything usable. */
export class CliNoOutputError extends CliError {
  constructor(readonly command: string) {
    super(`${command} exited without producing a message`);
    this.name = "CliNoOutputError";
  }
}

/** The caller aborted the call through an `AbortSignal`. */
export class CliAbortError extends CliError {
  constructor(readonly command: string) {
    super(`${command} was aborted by the caller`);
    this.name = "CliAbortError";
  }
}
