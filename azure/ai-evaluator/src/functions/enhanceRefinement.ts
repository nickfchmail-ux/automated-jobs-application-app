import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { chatCompletion } from "../lib/ai.js";
import {
  consumeUsage,
  refundUsage,
  UsageLimitReachedError,
} from "../lib/usage.js";

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
 * Body: { userId, refinement: string, type: "resume" | "cover-letter" }
 *
 * Returns: { ok: true, enhanced: string }  (plain text, no JSON wrapper)
 *
 * USAGE: Each successful Enhance consumes ONE fine-tune quota for the
 * document type (same pool as Regenerate). The backend is the single writer
 * — `consumeUsage` blocks (402 LIMIT_REACHED) once the user is out of quota,
 * so the button can't be clicked past the plan limit. If the LLM call fails,
 * the just-consumed quota is refunded (nothing was actually produced).
 */
export const enhanceRefinement: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  context.log("enhanceRefinement trigger invoked");

  let body: { userId?: string; refinement?: string; type?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const refinement =
    typeof body?.refinement === "string" ? body.refinement.trim() : "";
  const type = body?.type === "cover-letter" ? "cover-letter" : "resume";

  if (!userId) {
    return json({ ok: false, error: "userId is required" }, 400);
  }
  if (!refinement) {
    return json({ ok: false, error: "refinement is required" }, 400);
  }
  // Cap the input at 300 WORDS (not just 2000 chars) so a malicious or huge
  // paste can't inflate AI token costs. ~300 words is far more than any real
  // fine-tune note.
  const WORD_LIMIT = 300;
  const wordCount = refinement.split(/\s+/).filter(Boolean).length;
  if (wordCount > WORD_LIMIT) {
    return json(
      {
        ok: false,
        error: `Please keep your note under ${WORD_LIMIT} words (you wrote ${wordCount}).`,
      },
      400,
    );
  }
  if (refinement.length > 2000) {
    return json(
      { ok: false, error: "refinement is too long (max 2000 chars)" },
      400,
    );
  }

  // Tracks whether a fine-tune quota row was consumed so the catch-all can
  // refund it (declared here so both the try body and the catch can see it).
  let usageId: string | null = null;

  try {
    // ── AUTHORITATIVE USAGE ENFORCEMENT ───────────────────────
    // Consume ONE fine-tune quota for this document type BEFORE calling the
    // LLM. This is the single writer — if the user is out of quota (or a
    // concurrent double-click races past the client gate), reject with 402.
    try {
      const usageType =
        type === "resume" ? "fine_tune_resume" : "fine_tune_cover_letter";
      const usage = await consumeUsage(userId, usageType);
      if (!usage.ok) {
        if (usage.reason === "limit_reached") {
          return json({ ok: false, error: `LIMIT_REACHED: ${usage.message}` }, 402);
        }
        return json({ ok: false, error: usage.message }, 400);
      }
      usageId = usage.id ?? null;
    } catch (e) {
      if (e instanceof UsageLimitReachedError) {
        return json(
          { ok: false, error: `LIMIT_REACHED: ${e.message}` },
          402,
        );
      }
      throw e;
    }

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
      // The LLM didn't produce anything — refund the consumed quota.
      if (usageId != null) {
        await refundUsage(
          userId,
          type === "resume" ? "fine_tune_resume" : "fine_tune_cover_letter",
        ).catch(() => {});
      }
      return json({ ok: false, error: "LLM returned an empty response" }, 502);
    }

    return json({ ok: true, enhanced: content }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`enhanceRefinement failed: ${msg}`);
    // Refund the quota — the Enhance failed so the user shouldn't be charged.
    // Only refund when we actually consumed (usageId set); a failure inside
    // `consumeUsage` itself means nothing was deducted.
    if (usageId != null) {
      try {
        await refundUsage(
          userId,
          type === "resume" ? "fine_tune_resume" : "fine_tune_cover_letter",
        );
      } catch {
        /* best-effort */
      }
    }
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
