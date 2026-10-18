"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal in-app toast notifications (no external dependency).
 *
 * Used to surface AI failures, warnings and action results that previously
 * only went to the server console — e.g. "AI report generation failed:
 * All LLM providers failed..." — so the user can actually see what happened.
 *
 * Mount <ToastProvider> once in the dashboard layout; call useToast() in any
 * client component: toast.error(title, description?), toast.success(...),
 * toast.warning(...), toast.info(...).
 */

export type ToastVariant = "error" | "warning" | "success" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return ctx;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: typeof Info; container: string; iconColor: string }
> = {
  error: {
    icon: XCircle,
    container:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100",
    iconColor: "text-red-500",
  },
  warning: {
    icon: AlertTriangle,
    container:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
    iconColor: "text-amber-500",
  },
  success: {
    icon: CheckCircle2,
    container:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
    iconColor: "text-emerald-500",
  },
  info: {
    icon: Info,
    container:
      "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100",
    iconColor: "text-sky-500",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      idRef.current += 1;
      const id = idRef.current;
      // Keep at most 5 toasts on screen; drop the oldest.
      setToasts((prev) => [...prev.slice(-4), { id, variant, title, description }]);
      const ttl = variant === "error" ? 10000 : 6000;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      error: (title, description) => push("error", title, description),
      warning: (title, description) => push("warning", title, description),
      success: (title, description) => push("success", title, description),
      info: (title, description) => push("info", title, description),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Positioned below the sticky dashboard header (h-14); full-width on phones */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-3 top-16 z-[100] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 sm:right-6"
      >
        {toasts.map((t) => {
          const style = VARIANT_STYLES[t.variant];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg",
                style.container
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs leading-relaxed break-words opacity-90">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
