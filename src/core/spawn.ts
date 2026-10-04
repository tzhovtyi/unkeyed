import { spawn } from "node:child_process";
import {
  CliAbortError,
  CliExitError,
  CliNotFoundError,
  CliTimeoutError,
} from "./errors.js";

export type SpawnTextOptions = {
  command: string;
  args: readonly string[];
  /** Written to the child's stdin, which is then closed. */
  stdin: string;
  cwd: string;
  timeoutMs: number;
  /** Appended to the not-found error: how to install the binary. */
  notFoundHint?: string;
  /** Deleted before the child starts. See {@link childEnv}. */
  strippedEnv?: readonly string[] | undefined;
};

/** Runs a command to completion; rejects with a {@link CliError} subclass per failure. */
export function runText(options: SpawnTextOptions): Promise<string> {
  const { command, args, stdin, cwd, timeoutMs, notFoundHint, strippedEnv } = options;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(undefined, strippedEnv),
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new CliTimeoutError(command, timeoutMs));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    // A child that dies before reading stdin would surface as an unhandled EPIPE.
    child.stdin.on("error", () => {});

    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new CliNotFoundError(
              command,
              `${command} not found` + (notFoundHint ? `. ${notFoundHint}` : ""),
              { cause: error },
            )
          : error,
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new CliExitError(command, code, signal, stdout, stderr));
    });

    child.stdin.end(stdin);
  });
}

export type SpawnStreamOptions = SpawnTextOptions & {
  /** Merged over the parent's environment. */
  env?: Record<string, string | undefined> | undefined;
  signal?: AbortSignal | undefined;
};

export type JsonLineStream = {
  /** Unparseable lines are skipped: CLIs interleave non-JSON notices. */
  lines: AsyncGenerator<unknown>;
  /** Kills the child and marks the stream finished, so the non-zero exit is not a failure. */
  stop(): void;
};

/** Runs a command and streams its newline-delimited JSON output. */
export function runJsonLines(options: SpawnStreamOptions): JsonLineStream {
  const { command, args, stdin, cwd, timeoutMs, notFoundHint, env, signal, strippedEnv } = options;

  const child = spawn(command, [...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv(env, strippedEnv),
  });

  let stderr = "";
  let stopped = false;
  let timedOut = false;
  let aborted = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const stop = (): void => {
    stopped = true;
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };

  const onAbort = (): void => {
    aborted = true;
    stop();
  };
  // A signal that fired before the spawn never reaches a later listener.
  if (signal?.aborted === true) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });

  // Spawn failure and exit funnel here. It resolves, never rejects: nothing awaits it yet.
  type Exit = { code: number | null; signal: string | null; error?: unknown };
  const exited = new Promise<Exit>((resolve) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        error:
          error.code === "ENOENT"
            ? new CliNotFoundError(
                command,
                `${command} not found` + (notFoundHint ? `. ${notFoundHint}` : ""),
                { cause: error },
              )
            : error,
      });
    });
    child.on("close", (code, signalCode) => {
      clearTimeout(timer);
      resolve({ code, signal: signalCode });
    });
  });

  // Nothing reads the prompt if the child died on startup; the exit reports why.
  child.stdin.on("error", () => {});
  child.stdin.end(stdin);

  async function* lines(): AsyncGenerator<unknown> {
    try {
      let buffer = "";
      try {
        for await (const chunk of child.stdout) {
          buffer += (chunk as Buffer).toString();
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line) continue;
            const parsed = parseLine(line);
            if (parsed !== undefined) yield parsed;
          }
        }
        const tail = buffer.trim();
        if (tail) {
          const parsed = parseLine(tail);
          if (parsed !== undefined) yield parsed;
        }
      } catch (error) {
        // A destroyed pipe is a symptom; the exit says what happened.
        const { error: spawnError } = await exited;
        throw spawnError ?? error;
      }

      const { code, signal: signalCode, error } = await exited;
      if (error !== undefined) throw error;
      if (aborted) throw new CliAbortError(command);
      if (timedOut) throw new CliTimeoutError(command, timeoutMs);
      if (!stopped && code !== 0) throw new CliExitError(command, code, signalCode, "", stderr);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      stop();
    }
  }

  return { lines: lines(), stop };
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/** The parent's environment minus the credentials the CLI would otherwise prefer. */
function childEnv(
  overrides: Record<string, string | undefined> | undefined,
  stripped: readonly string[] | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of stripped ?? []) delete env[key];
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
  return env;
}
