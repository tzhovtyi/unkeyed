/** For the type checker: a union of two *overloaded* `create`s is uncallable, so this
 * constructor is typed as producing `Anthropic`. The import is type-only. */
import type Anthropic from "@anthropic-ai/sdk";
import { Unkeyed as Implementation, type UnkeyedMeta, type UnkeyedOptions } from "./api/anthropic/index.js";

/** Namespaces with no CLI equivalent throw `NotImplementedError` on access. */
export const Unkeyed = Implementation as unknown as new (options?: UnkeyedOptions) => Anthropic;

/** Reads back `_unkeyed`, which the SDK's `Message` type does not know about. */
export function meta(response: object): UnkeyedMeta | undefined {
  return (response as { _unkeyed?: UnkeyedMeta })._unkeyed;
}

export type { UnkeyedMeta, UnkeyedOptions } from "./api/anthropic/index.js";
