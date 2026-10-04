/** An IR request → a Claude Code command line. */
import type { EncodeContext, Invocation } from "../adapter.js";
import type { Request } from "../../ir/index.js";
import { streamArgs } from "./args.js";
import { planFor, writeBridge, type ToolPlan } from "./tools.js";

export async function encode(
  request: Request,
  context: EncodeContext,
): Promise<Invocation<ToolPlan>> {
  const warnings: string[] = [];
  const plan = planFor(request.tools);

  const args = streamArgs({
    model: request.model,
    systemPrompt: request.systemPrompt,
    effort: request.effort,
  });

  if (plan.kind === "schema" && request.tools.kind === "forced") {
    args.push("--json-schema", JSON.stringify(request.tools.tool.schema));
  } else if (plan.kind === "bridge" && request.tools.kind === "auto") {
    // Created here and nowhere else: a request without tools writes no files.
    args.push(...(await writeBridge(await context.scratchDir(), request.tools.tools)));
  } else if (plan.kind === "none" && request.tools.kind !== "none") {
    warnings.push("`tools` were provided but could not be exposed; the model answered without them.");
  }

  return {
    args,
    stdin: JSON.stringify({ type: "user", message: { role: "user", content: request.prompt } }) + "\n",
    plan,
    warnings,
  };
}
