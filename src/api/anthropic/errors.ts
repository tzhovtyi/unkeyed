/** Shaped like `@anthropic-ai/sdk`'s errors but not its classes: `instanceof` is false. */
import {
  CliAbortError,
  CliExitError,
  CliNoOutputError,
  CliNotFoundError,
  CliRateLimitError,
  CliResponseError,
  CliTimeoutError,
} from "../../core/errors.js";

export class UnkeyedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnkeyedError";
  }
}

export type ApiErrorBody = {
  type: "error";
  error: { type: string; message: string };
};

export class APIError extends UnkeyedError {
  readonly headers: Record<string, string> = {};
  readonly requestID: string | null = null;

  constructor(
    readonly status: number | undefined,
    readonly error: ApiErrorBody["error"],
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `${status ?? "unknown"} ${error.message}`, options);
    this.name = "APIError";
  }
}

export class BadRequestError extends APIError {
  constructor(message: string, type = "invalid_request_error") {
    super(400, { type, message });
    this.name = "BadRequestError";
  }
}

export class AuthenticationError extends APIError {
  constructor(message: string) {
    super(401, { type: "authentication_error", message });
    this.name = "AuthenticationError";
  }
}

export class PermissionDeniedError extends APIError {
  constructor(message: string) {
    super(403, { type: "permission_error", message });
    this.name = "PermissionDeniedError";
  }
}

export class NotFoundError extends APIError {
  constructor(message: string) {
    super(404, { type: "not_found_error", message });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends APIError {
  constructor(
    message: string,
    /** Unix seconds when the subscription window resets, when the CLI reports it. */
    readonly resetsAt?: number | undefined,
  ) {
    super(429, { type: "rate_limit_error", message });
    this.name = "RateLimitError";
  }
}

export class InternalServerError extends APIError {
  constructor(message: string, status = 500, type = "api_error") {
    super(status, { type, message });
    this.name = "InternalServerError";
  }
}

/** The CLI could not be run, or died before answering. */
export class APIConnectionError extends APIError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(undefined, { type: "api_connection_error", message }, message, options);
    this.name = "APIConnectionError";
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(message: string) {
    super(message);
    this.name = "APIConnectionTimeoutError";
  }
}

export class APIUserAbortError extends APIError {
  constructor(message = "Request was aborted.") {
    super(undefined, { type: "user_abort_error", message }, message);
    this.name = "APIUserAbortError";
  }
}

/** An `api_error_status` means the upstream API refused; anything else is a 500. */
export function apiErrorFor(
  message: string,
  details: { apiErrorStatus?: string | null | undefined; subtype?: string | undefined },
): APIError {
  const status = Number(details.apiErrorStatus);
  if (Number.isFinite(status)) {
    switch (status) {
      case 400:
        return new BadRequestError(message);
      case 401:
        return new AuthenticationError(message);
      case 403:
        return new PermissionDeniedError(message);
      case 404:
        return new NotFoundError(message);
      case 429:
        return new RateLimitError(message);
      default:
        return new InternalServerError(message, status, status === 529 ? "overloaded_error" : "api_error");
    }
  }
  return new InternalServerError(message);
}

/** Raised on *access*, so the stack points at the line that reached for it. */
export class NotImplementedError extends UnkeyedError {
  constructor(
    readonly feature: string,
    reason: string,
  ) {
    super(
      `\`${feature}\` is not implemented by unkeyed: ${reason}. ` +
        "Use the real Anthropic client for this, or see the README for what is supported.",
    );
    this.name = "NotImplementedError";
  }
}

/** Every `CliError` the runner can raise, given the status the API would return. */
export function asApiError(error: unknown): unknown {
  if (error instanceof APIError) return error;
  if (error instanceof CliAbortError) return new APIUserAbortError();
  if (error instanceof CliTimeoutError) {
    return new APIConnectionTimeoutError(`the CLI did not answer within ${error.timeoutMs} ms`);
  }
  if (error instanceof CliNotFoundError) {
    return new APIConnectionError(error.message, { cause: error });
  }
  if (error instanceof CliRateLimitError) {
    return new RateLimitError(error.message, error.details.resetsAt);
  }
  if (error instanceof CliResponseError) {
    return apiErrorFor(error.message, error.details);
  }
  if (error instanceof CliNoOutputError) {
    return new InternalServerError(error.message);
  }
  if (error instanceof CliExitError) {
    const detail = error.stderr.trim() || error.stdout.trim() || "no output";
    if (UNAUTHENTICATED.test(detail)) {
      return new AuthenticationError(
        `the CLI is not signed in. Run \`${error.command} auth login\`. It said: ${detail}`,
      );
    }
    return new InternalServerError(`the CLI failed: ${detail}`);
  }
  return error;
}

/** Phrases the CLI uses when the problem is that nobody is signed in. */
const UNAUTHENTICATED =
  /not logged in|log in|sign in|authentication|unauthorized|invalid api key|\/login/i;
