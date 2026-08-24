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
    void (async () => {
      const res = await listSearchKeysAction(runId);
      if (!alive) return;
      setLoaded(true);
      if (res.ok) setKeys(res.keys);
      else setKeys([]);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, runCompleted, refreshKey]);

  const unevaluatedTotal = keys.reduce((n, k) => n + k.unevaluated, 0);

  return { keys, unevaluatedTotal, loaded, reload };
}
