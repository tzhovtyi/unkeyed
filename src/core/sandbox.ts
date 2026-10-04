import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "./once.js";

/** CLIs walk up from the cwd for configuration, so an empty one keeps a call hermetic. */
export function scratchDir(prefix: string): () => Promise<string> {
  return once(() => mkdtemp(path.join(tmpdir(), prefix)));
}
