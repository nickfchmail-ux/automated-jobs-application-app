import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { chatCompletion } from "../lib/ai.js";

/**
 * POST /api/documents/enhance-refinement
 *
 * AI-assist for the fine-tune input. The user types a rough note ("make it
 * more concise", "fix the summary"), and this endpoint asks the LLM to
 * rewrite it into a clearer, more specific, ready-to-use refinement
 * instruction. The result REPLACES the user's textarea content — it is NOT
 * sent to document generation directly (the user can still edit before
 * clicking Regenerate).
 *
 * Body: { refinement: string, type: "resume" | "cover-letter" }
 *
 * Returns: { ok: true, enhanced: string }  (plain text, no JSON wrapper)
 */
export const enhanceRefinement: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  context.log("enhanceRefinement trigger invoked");

  let body: { refinement?: string; type?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const refinement =
    typeof body?.refinement === "string" ? body.refinement.trim() : "";
  const type = body?.type === "cover-letter" ? "cover-letter" : "resume";

  if (!refinement) {
    return json(
      { ok: false, error: "refinement is required" },
      400,
    );
  }
  if (refinement.length > 2000) {
    return json(
      { ok: false, error: "refinement is too long (max 2000 chars)" },
      400,
    );
  }

  try {
    const system = `You are a helpful writing assistant for a job-application tool. The user wants to fine-tune a generated ${type === "resume" ? "tailored resume" : "cover letter"}. They typed a rough note about what to change. Rewrite it into ONE clear, specific, actionable refinement instruction (2-4 short sentences) that an LLM can apply directly.

Rules:
- Keep the user's intent exactly — do NOT add new requests or drop any.
- Be specific and concrete (e.g. "emphasize X", "shorten to one page", "rewrite the summary to mention Y").
- Use plain, imperative language. No greetings, no filler, no markdown, no bullet points.
- Output ONLY the rewritten instruction as plain text.`;

    const completion = await chatCompletion(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: `My note: "${refinement}"\n\nRewrite it as one clear refinement instruction.`,
        },
      ],
      { temperature: 0.4, maxTokens: 500, timeoutMs: 30_000, jsonMode: false },
    );

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return json({ ok: false, error: "LLM returned an empty response" }, 502);
    }

    return json({ ok: true, enhanced: content }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`enhanceRefinement failed: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
};

function json(body: unknown, status: number): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: new Headers({ "Content-Type": "application/json" }),
  };
}
