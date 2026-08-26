"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info";
type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
};

type ToastApi = {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<
  ToastKind,
  { icon: ReactNode; ring: string; bar: string }
> = {
  success: {
    icon: <CheckCircleIcon className="w-5 h-5 text-[var(--good)]" />,
    ring: "border-[var(--good)]/20",
    bar: "bg-[var(--good)]",
  },
  error: {
    icon: <ErrorIcon className="w-5 h-5 text-[var(--bad)]" />,
    ring: "border-[var(--bad)]/20",
    bar: "bg-[var(--bad)]",
  },
  info: {
    icon: <InfoIcon className="w-5 h-5 text-[var(--accent)]" />,
    ring: "border-[var(--accent)]/20",
    bar: "bg-[var(--accent)]",
  },
};

const AUTO_DISMISS_MS = 4500;

/**
 * Lightweight toast system for JobSeek.
 *
 * Mount <ToastProvider> once (app-wide via ProviderManager) and call
 * `useToast().success("Saved", "Your resume is ready")` from anywhere.
 * Animates in/out with `motion` (AnimatePresence) — Stripe-style: a quiet
 * card slides up from the bottom-right with a colored accent bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, kind, title, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, m) => push("success", t, m),
      error: (t, m) => push("error", t, m),
      info: (t, m) => push("info", t, m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast stack — bottom-right, above everything */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 w-full max-w-sm pointer-events-none"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const s = KIND_STYLES[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{
                  type: "spring",
                  stiffness: 380,
                  damping: 30,
                }}
                className={`pointer-events-auto relative w-full overflow-hidden rounded-xl border ${s.ring} bg-[var(--surface)] shadow-lg shadow-black/5 dark:shadow-black/30`}
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 shrink-0">{s.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {t.title}
                    </p>
                    {t.message && (
                      <p className="mt-0.5 text-xs text-[var(--ink-soft)] leading-relaxed">
                        {t.message}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="shrink-0 rounded-md p-1 text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--paper-soft)] transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                {/* Accent bar */}
                <motion.span
                  className={`absolute left-0 top-0 h-full w-1 ${s.bar}`}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  style={{ originY: 0 }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
