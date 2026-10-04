import assert from "node:assert/strict";
import test from "node:test";
import { once } from "../src/core/once.js";

test("produces the value a single time", async () => {
  let calls = 0;
  const get = once(async () => ++calls);
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  assert.equal(calls, 1);
});

test("shares one in-flight call between concurrent callers", async () => {
  let calls = 0;
  const get = once(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return calls;
  });
  assert.deepEqual(await Promise.all([get(), get(), get()]), [1, 1, 1]);
  assert.equal(calls, 1);
});

test("does not cache a rejection, so a later attempt can succeed", async () => {
  let calls = 0;
  const get = once(async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient");
    return "ok";
  });
  await assert.rejects(get(), /transient/);
  assert.equal(await get(), "ok");
  assert.equal(calls, 2);
});
