import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requireCache = (Module as any)._cache as Record<string, unknown>;

/* ------------------------------------------------------------------ */
/*  Module mocking (CJS): swap the evaluator's lib modules in the      */
/*  require cache so the orchestrator runs against a fake Supabase +   */
/*  fake LLM, proving the END-TO-END evaluation flow without network.  */
/* ------------------------------------------------------------------ */

/** A fake Supabase query builder that supports the chain used by runEvaluator. */
function fakeSupabase(opts: {
  jobs?: unknown[];
  evaluationRunsDeleteError?: { message: string } | null;
  evaluationRunsInsertError?: { message: string } | null;
  jobUpdateError?: { message: string } | null;
}) {
  const calls = {
    jobsUpdate: [] as unknown[],
    evalRunsDelete: [] as unknown[],
    evalRunsInsert: [] as unknown[],
    pipelineUpdate: [] as unknown[],
  };

  /**
   * Build a query builder whose filter/select methods are no-ops and whose
   * terminal methods (update/delete/insert) record into per-table trackers.
   * `then` resolves with `result()` so `await` works.
   */
  function chainFor(table: string, result: () => unknown) {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      is: () => builder,
      limit: () => builder,
      order: () => builder,
      delete: () => {
        if (table === "evaluation_runs") calls.evalRunsDelete.push(true);
        return builder;
      },
      update: (patch: unknown) => {
        if (table === "jobs") calls.jobsUpdate.push(patch);
        if (table === "pipeline_runs") calls.pipelineUpdate.push(patch);
        return builder;
      },
      insert: (rows: unknown) => {
        if (table === "evaluation_runs") calls.evalRunsInsert.push(rows);
        return builder;
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        try {
          resolve(result());
        } catch (e) {
          reject?.(e);
        }
      },
    };
    return builder;
  }

  // For evaluation_runs insert(...).select(...).then(...), resolve with
  // generated ids keyed by keyword (what the orchestrator consumes).
  function evalRunsInsertChain() {
    const builder = chainFor("evaluation_runs", () => ({
      error: opts.evaluationRunsInsertError ?? null,
    }));
    const origInsert = builder.insert as (rows: unknown) => unknown;
    builder.insert = (rows: unknown) => {
      origInsert(rows);
      const rowList = (Array.isArray(rows) ? rows : [rows]) as {
        keyword?: string;
      }[];
      const generated = rowList.map((row, i) => ({
        id: `eval-${i}`,
        keyword: row.keyword ?? "general",
      }));
      return {
        ...builder,
        select: () => ({
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: generated, error: null }),
        }),
      };
    };
    return builder;
  }

  const sb = {
    from: (table: string) => {
      if (table === "jobs") {
        return chainFor(table, () => ({ data: opts.jobs ?? [], error: null }));
      }
      if (table === "evaluation_runs") {
        return evalRunsInsertChain();
      }
      // pipeline_runs
      return chainFor(table, () => ({ error: null }));
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({
          data: { publicUrl: "https://cdn/resume.html" },
        }),
      }),
    },
    __calls: calls,
  };
  return sb;
}

// Track what the fake LLM returns per jobId.
const llmResponses = new Map<string, unknown>();
const llmCalls: string[] = [];
const notifyCalls: { userId: string; runId: string }[] = [];
const resumeWrites: unknown[] = [];

function mockModule(specifier: string, exports: unknown) {
  const resolved = require.resolve(specifier);
  requireCache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

function installMocks(sb: ReturnType<typeof fakeSupabase>) {
  // Supabase
  mockModule("../src/lib/supabase.js", { getSupabase: () => sb });

  // LLM
  mockModule("../src/lib/ai.js", {
    evaluateSingleJobWithLLM: async (msgs: unknown) => {
      llmCalls.push("eval");
      const jobId = extractJobId(msgs);
      const resp = llmResponses.get(jobId) ?? {
        jobId,
        fit: false,
        fit_score: 10,
        fit_reasons: [],
        not_fit_reasons: [],
        cover_letter: null,
        expected_salary: null,
      };
      return resp;
    },
    generateResumeWithLLM: async () => ({
      resumeHtml: "<html><body>Tailored resume</body></html>",
    }),
    parseSingleJobResult: () => ({}),
    parseResumeDocument: () => ({ resumeHtml: "" }),
  });

  // Resume fetch (return real sanitizer with a canned resume)
  const resume = require("../src/lib/resume.js");
  mockModule("../src/lib/resume.js", {
    ...resume,
    fetchResumeText: async () =>
      "# Jane Doe\njane@x.com\n## Skills\n- React\n- TypeScript\n## Experience\n- 8 years at Acme",
  });

  // Resume documents
  mockModule("../src/lib/resumeDocuments.js", {
    storeGeneratedResume: async (params: unknown) => {
      resumeWrites.push(params);
      return { resumeUrl: "https://cdn/resume.html", fileName: "x.html" };
    },
  });

  // Socket
  mockModule("../src/lib/socket.js", {
    notifyStateChange: async (userId: string, runId: string) => {
      notifyCalls.push({ userId, runId });
    },
  });
}

function extractJobId(msgs: unknown): string {
  const content = String((msgs as { content?: string }[])?.[1]?.content ?? "");
  const m = content.match(/"id":\s*"([^"]+)"/);
  return m ? m[1] : "unknown";
}

/** Require runEvaluator fresh so it picks up the mocked deps. */
function loadOrchestrator() {
  const path = require.resolve("../src/lib/runEvaluator.js");
  delete requireCache[path];
  return require(path).evaluateRun;
}

function job(id: string, searchKey = "react") {
  return {
    id,
    title: `Job ${id}`,
    company: "Acme",
    location: "HK",
    salary: "HKD 50k",
    raw_description: "React",
    short_description: null,
    responsibilities: null,
    requirements: null,
    benefits: null,
    skills: ["React"],
    employment_type: null,
    experience_level: null,
    search_key: searchKey,
    user_id: "user-1",
    pipeline_run_id: "run-1",
    url: "https://x",
    status: "completed",
  };
}

test("evaluateRun: scores fit + not-fit jobs, writes back, sets completed, notifies socket", async () => {
  const jobs = [job("job-fit", "react"), job("job-no", "react")];
  llmResponses.set("job-fit", {
    jobId: "job-fit",
    fit: true,
    fit_score: 88,
    fit_reasons: ["React"],
    not_fit_reasons: [],
    cover_letter: "Dear Acme...",
    expected_salary: "HKD 50k",
  });
  llmResponses.set("job-no", {
    jobId: "job-no",
    fit: false,
    fit_score: 22,
    fit_reasons: [],
    not_fit_reasons: ["no Azure"],
    cover_letter: null,
    expected_salary: null,
  });

  const sb = fakeSupabase({ jobs });
  installMocks(sb);
  const evaluateRun = loadOrchestrator();

  const result = await evaluateRun({
    pipelineRunId: "run-1",
    userId: "user-1",
    log: () => {},
  });

  assert.equal(result.totalJobs, 2);
  assert.equal(result.processedJobs, 2);
  assert.equal(result.failedJobs, 0);

  // Two job updates: fit (with resume) + not-fit (no resume)
  const updates = sb.__calls.jobsUpdate as Record<string, unknown>[];
  assert.equal(updates.length, 2);
  const fitUpdate = updates.find((u) => u.fit === true);
  assert.ok(fitUpdate, "fit job update exists");
  assert.equal(fitUpdate.cover_letter, "Dear Acme...");
  assert.equal(fitUpdate.resume_status, "completed");
  assert.equal(fitUpdate.resume_url, "https://cdn/resume.html");
  const noFitUpdate = updates.find((u) => u.fit === false);
  assert.ok(noFitUpdate, "not-fit job update exists");
  assert.equal(noFitUpdate.cover_letter, null);
  assert.equal(
    noFitUpdate.resume_status,
    undefined,
    "not-fit → no resume fields",
  );

  // Resume generated only for the fit job
  assert.equal(resumeWrites.length, 1);
  assert.equal((resumeWrites[0] as { jobId: string }).jobId, "job-fit");

  // Socket notified (start + per-job + terminal)
  assert.ok(
    notifyCalls.length >= 3,
    `expected >=3 socket notifies, got ${notifyCalls.length}`,
  );
  assert.ok(
    notifyCalls.every((c) => c.userId === "user-1" && c.runId === "run-1"),
  );

  // LLM: 2 eval calls + 1 resume call
  assert.equal(llmCalls.filter((c) => c === "eval").length, 2);
});

test("evaluateRun: idempotent — clears old evaluation_runs before inserting", async () => {
  const sb = fakeSupabase({ jobs: [job("j1")] });
  installMocks(sb);
  const evaluateRun = loadOrchestrator();

  await evaluateRun({
    pipelineRunId: "run-1",
    userId: "user-1",
    log: () => {},
  });

  const deletes = sb.__calls.evalRunsDelete as unknown[];
  assert.ok(deletes.length >= 1, "should delete old evaluation_runs");
  const inserts = sb.__calls.evalRunsInsert as unknown[];
  assert.ok(inserts.length >= 1, "should insert fresh evaluation_runs");
});

test("evaluateRun: throws when no jobs → caller marks failed", async () => {
  const sb = fakeSupabase({ jobs: [] });
  installMocks(sb);
  const evaluateRun = loadOrchestrator();

  await assert.rejects(
    () =>
      evaluateRun({ pipelineRunId: "run-1", userId: "user-1", log: () => {} }),
    /No saved jobs/,
  );
});

test("evaluateRun: throws when no resume", async () => {
  const sb = fakeSupabase({ jobs: [job("j1")] });
  installMocks(sb);
  // Override resume fetch to fail
  mockModule("../src/lib/resume.js", {
    fetchResumeText: async () => {
      throw new Error("No resume found for this user.");
    },
    sanitizeResume: (t: string) => t,
  });
  const evaluateRun = loadOrchestrator();

  await assert.rejects(
    () =>
      evaluateRun({ pipelineRunId: "run-1", userId: "user-1", log: () => {} }),
    /No resume found/,
  );
});

test("evaluateRun: fires LLM calls concurrently (overlap, not serial)", async () => {
  // 6 jobs → with default concurrency (20) all 6 eval calls should overlap.
  const jobs = Array.from({ length: 6 }, (_, i) => job(`job-${i}`, "react"));
  const sb = fakeSupabase({ jobs });
  installMocks(sb);

  // Track in-flight eval calls; each resolves after a 30ms delay.
  let active = 0;
  let maxActive = 0;
  const llmCallsStarted: string[] = [];
  mockModule("../src/lib/ai.js", {
    evaluateSingleJobWithLLM: async (msgs: { content?: string }[]) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const jobId = extractJobId(msgs);
      llmCallsStarted.push(jobId);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return {
        jobId,
        fit: false,
        fit_score: 10,
        fit_reasons: [],
        not_fit_reasons: [],
        cover_letter: null,
        expected_salary: null,
      };
    },
    generateResumeWithLLM: async () => ({ resumeHtml: "<html/>" }),
    parseSingleJobResult: () => ({}),
    parseResumeDocument: () => ({ resumeHtml: "" }),
  });

  const evaluateRun = loadOrchestrator();
  const result = await evaluateRun({
    pipelineRunId: "run-1",
    userId: "user-1",
    log: () => {},
  });

  assert.equal(result.processedJobs, 6);
  // With 6 jobs and concurrency 20, ALL should be in-flight at once.
  assert.equal(maxActive, 6, `expected 6 concurrent LLM calls, got ${maxActive}`);
  assert.equal(llmCallsStarted.length, 6);
});
