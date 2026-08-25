import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requireCache = (Module as any)._cache as Record<string, unknown>;

/* ------------------------------------------------------------------ */
/*  End-to-end test: HTTP trigger → enqueue → queue worker →           */
/*  orchestrator, with mocked Supabase / Service Bus / LLM.            */
/*  Proves the durable flow works without real Azure resources.        */
/* ------------------------------------------------------------------ */

const state = {
  runStatus: "completed" as string | null,
  evalStatus: "none" as string | null,
  searchKey: "react" as string | null,
  enqueued: [] as unknown[],
  jobs: [] as unknown[],
  jobUpdates: [] as unknown[],
  pipelineUpdates: [] as unknown[],
  evalRunsInserted: [] as unknown[],
  notifyCalls: 0,
};

function makeSupabase() {
  function chain(result: () => unknown) {
    let single = false;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      is: () => b,
      limit: () => b,
      order: () => b,
      maybeSingle: () => {
        single = true;
        return b;
      },
      update: (p: unknown) => {
        state.pipelineUpdates.push(p);
        return b;
      },
      insert: (r: unknown) => {
        state.evalRunsInserted.push(r);
        const rows = (Array.isArray(r) ? r : [r]) as { keyword?: string }[];
        const gen = rows.map((row, i) => ({
          id: `eval-${i}`,
          keyword: row.keyword ?? "general",
        }));
        return {
          ...b,
          select: () => ({
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: gen, error: null }),
          }),
        };
      },
      delete: () => b,
      then: (resolve: (v: unknown) => void) => {
        const raw = result();
        const data = (raw as { data?: unknown })?.data ?? raw;
        // For a maybeSingle query on a list-shaped result, return the first.
        if (single && Array.isArray(data)) {
          resolve({ data: data[0] ?? null, error: null });
        } else {
          resolve(raw);
        }
      },
    };
    return b;
  }

  const sb = {
    from: (table: string) => {
      if (table === "pipeline_runs") {
        return chain(() => ({
          data: {
            id: "run-1",
            status: state.runStatus,
            evaluation_status: state.evalStatus,
            search_key: state.searchKey,
          },
          error: null,
        }));
      }
      if (table === "jobs") {
        // The trigger lists all jobs; the worker loads one via maybeSingle
        // (the `then` handler returns the first when `single` is set).
        return chain(() => ({ data: state.jobs, error: null }));
      }
      if (table === "evaluation_runs") {
        return chain(() => ({ error: null }));
      }
      return chain(() => ({ error: null }));
    },
    rpc: async (name: string) => {
      if (name === "increment_evaluation_run") {
        return {
          data: {
            total: state.jobs.length,
            processed: state.jobs.length,
            failed: 0,
            done: true,
          },
          error: null,
        };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://cdn/r.html" } }),
      }),
    },
  };
  return sb;
}

function installMocks(sb: ReturnType<typeof makeSupabase>) {
  const mock = (spec: string, exports: unknown) => {
    const resolved = require.resolve(spec);
    requireCache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports,
      children: [],
      paths: [],
    };
  };

  mock("../src/lib/supabase.js", { getSupabase: () => sb });
  mock("../src/lib/serviceBus.js", {
    enqueueEvaluation: async (body: unknown) => {
      state.enqueued.push(body);
      return "msg-1";
    },
    enqueueEvaluationJobs: async (msgs: unknown[]) => {
      state.enqueued.push(...msgs);
    },
    enqueueDocumentRequest: async (msg: unknown) => {
      state.enqueued.push(msg);
      return "doc-msg";
    },
  });
  mock("../src/lib/ai.js", {
    evaluateSingleJobWithLLM: async (msgs: { content?: string }[]) => ({
      jobId: extractId(msgs),
      fit: true,
      fit_score: 85,
      fit_reasons: ["React"],
      not_fit_reasons: [],
      cover_letter: "Dear team",
      expected_salary: "HKD 40k",
    }),
    generateResumeWithLLM: async () => ({ resumeHtml: "<html/>" }),
    parseSingleJobResult: () => ({}),
    parseResumeDocument: () => ({ resumeHtml: "" }),
  });
  const resume = require("../src/lib/resume.js");
  mock("../src/lib/resume.js", {
    ...resume,
    fetchResumeText: async () => "# Jane\n## Skills\n- React",
  });
  mock("../src/lib/resumeDocuments.js", {
    storeGeneratedResume: async () => ({
      resumeUrl: "https://cdn/r.html",
      fileName: "x",
    }),
  });
  mock("../src/lib/socket.js", {
    notifyStateChange: async () => {
      state.notifyCalls++;
    },
  });
}

function extractId(msgs: { content?: string }[]): string {
  const m = String(msgs[1]?.content ?? "").match(/"id":\s*"([^"]+)"/);
  return m ? m[1] : "unknown";
}

function fresh(spec: string) {
  const p = require.resolve(spec);
  delete requireCache[p];
  return require(p);
}

test("e2e: HTTP evaluate → enqueues one message per job → returns 202", async () => {
  state.runStatus = "completed";
  state.evalStatus = "none";
  state.enqueued = [];
  state.jobs = [
    { id: "job-1", search_key: "react", fit_score: null, status: "completed" },
    { id: "job-2", search_key: "react", fit_score: null, status: "completed" },
  ];
  const sb = makeSupabase();
  installMocks(sb);

  const { evaluate } = fresh("../src/functions/evaluate.js");
  const req = {
    json: async () => ({
      runId: "run-1",
      user_id: "user-1",
      search_key: "react",
    }),
  };
  const context = { log: () => {}, error: () => {} };
  const res = await evaluate(req as never, context as never);

  assert.equal(res.status, 202);
  assert.equal((res.jsonBody as { status: string }).status, "queued");
  assert.equal(state.enqueued.length, 2, "one message enqueued per job");
  assert.equal(
    (state.enqueued[0] as { jobId: string }).jobId,
    "job-1",
    "fan-out message carries the job id",
  );
});

test("e2e: HTTP rejects when run is not completed (run-scoped, no key)", async () => {
  state.runStatus = "scraping";
  state.searchKey = null;
  state.enqueued = [];
  const sb = makeSupabase();
  installMocks(sb);
  const { evaluate } = fresh("../src/functions/evaluate.js");
  const req = { json: async () => ({ runId: "run-1", user_id: "user-1" }) };
  const context = { log: () => {}, error: () => {} };
  const res = await evaluate(req as never, context as never);
  assert.equal(res.status, 409);
  assert.equal(state.enqueued.length, 0, "nothing enqueued while scraping");
  state.runStatus = "completed";
  state.searchKey = "react";
});

test("e2e: queue worker scores one job and finalizes the batch", async () => {
  state.jobs = [
    {
      id: "job-1",
      title: "React Dev",
      company: "Acme",
      location: null,
      salary: null,
      raw_description: "React",
      short_description: null,
      responsibilities: null,
      requirements: null,
      benefits: null,
      skills: ["React"],
      employment_type: null,
      experience_level: null,
      search_key: "react",
      user_id: "user-1",
      pipeline_run_id: "run-1",
      url: null,
      status: "completed",
    },
  ];
  state.jobUpdates = [];
  state.pipelineUpdates = [];
  state.evalRunsInserted = [];
  state.notifyCalls = 0;

  const sb = makeSupabase();
  installMocks(sb);
  // The worker's jobs query runs through the mocked supabase `jobs` table.
  // Patch the jobs chain to record updates too.
  (state as { jobUpdates: unknown[] }).jobUpdates = [];
  const origFrom = sb.from.bind(sb);
  (sb as { from: (t: string) => unknown }).from = (table: string) => {
    const c = origFrom(table);
    if (table === "jobs") {
      c.update = (p: unknown) => {
        state.jobUpdates.push(p);
        return c;
      };
    }
    return c;
  };

  const { evaluateWorker } = fresh("../src/functions/evaluateWorker.js");
  await evaluateWorker(
    {
      jobId: "job-1",
      userId: "user-1",
      runId: "run-1",
      evaluationRunId: "eval-0",
      keyword: "react",
    } as never,
    { log: () => {}, error: () => {} } as never,
  );

  assert.equal(state.jobUpdates.length, 1, "job was scored + written back");
  const up = state.jobUpdates[0] as {
    fit: boolean;
    resume_status: string;
    cover_letter_status: string;
  };
  assert.equal(up.fit, true);
  // Decoupled flow: the worker SCORES the job and marks both documents
  // `building` (the dedicated resume/cover-letter workers generate them).
  assert.equal(up.resume_status, "building");
  assert.equal(up.cover_letter_status, "building");
  assert.ok(state.notifyCalls >= 1, "socket notified on progress");

  // Fit job → one message enqueued to EACH dedicated document queue.
  const docMsgs = state.enqueued.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      ((m as { type?: string }).type === "resume" ||
        (m as { type?: string }).type === "cover-letter"),
  );
  assert.equal(docMsgs.length, 2, "fit job enqueues resume + cover letter");
  assert.ok(
    docMsgs.some((m) => (m as { type: string }).type === "resume"),
    "a resume-requests message was enqueued",
  );
  assert.ok(
    docMsgs.some((m) => (m as { type: string }).type === "cover-letter"),
    "a cover-letter-requests message was enqueued",
  );
});
