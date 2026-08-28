"use client";

import {
  listSearchKeysAction,
  type SearchKeyOption,
} from "@/app/actions/evaluate";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads the search keys that still have unevaluated posts — ACROSS ALL of the
 * user's runs — plus the total number of jobs still needing a match.
 *
 * This is the single source of truth for "what's left to match?" — used by
 * both the LiveRunCard's match prompt and the EvaluationStep dropdown so the
 * two can never disagree about the numbers.
 *
 * The list is account-wide (every search key with unevaluated posts), not
 * scoped to one run. `runId` is only used to highlight the current search's
 * key in the UI.
 *
 * Re-loads whenever `refreshKey` changes (e.g. the run completes, an
 * evaluation finishes, or the user clicks Match) so evaluated keys drop out
 * immediately.
 */
export function useSearchKeys(
  runId: string | null = null,
  runCompleted = true,
  refreshKey?: string | number,
) {
  const [keys, setKeys] = useState<SearchKeyOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!runCompleted) {
      setKeys([]);
      setLoaded(false);
      return;
    }
    const res = await listSearchKeysAction(runId);
    if (res.ok) {
      setKeys(res.keys);
    } else {
      setKeys([]);
    }
    setLoaded(true);
  }, [runId, runCompleted]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const res = await listSearchKeysAction(runId);
      if (!alive) return;
      setLoaded(true);
      if (res.ok) setKeys(res.keys);
      else setKeys([]);
    }

    void load();

    // Poll periodically so the dropdown's unevaluated counts stay in sync
    // with the live run — jobs keep landing in Supabase after the page loads,
    // and without a refresh the dropdown would show a stale snapshot (e.g.
    // "15 to match" while the run has already found 30). A modest interval
    // keeps the counts current without hammering the DB while idle.
    const interval = setInterval(load, 20_000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, runCompleted, refreshKey]);

  const unevaluatedTotal = keys.reduce((n, k) => n + k.unevaluated, 0);

  return { keys, unevaluatedTotal, loaded, reload };
}
