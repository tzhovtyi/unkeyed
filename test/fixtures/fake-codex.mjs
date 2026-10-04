#!/usr/bin/env node
// A CLI that is not Claude Code, proving the surfaces run on whichever adapter they are given.
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
const prompt = stdin.trim();

const say = (line) => process.stdout.write(JSON.stringify(line) + "\n");

say({ t: "begin", model: "codex-mini" });
// The one mode this fixture has: report the argv it was handed.
const body = prompt === "MODE:args" ? JSON.stringify(process.argv.slice(2)) : `codex says ${prompt}`;
for (const piece of [body.slice(0, 5), body.slice(5)]) {
  if (piece) say({ t: "text", chunk: piece });
}
say({ t: "end", reason: "stop", cents: 2, ms: 7 });
