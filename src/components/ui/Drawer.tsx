import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}

/** Right-hand slide-over: lighter than Modal — the page stays visible for
 * context. Esc/backdrop close + focus restore; no tab trap (v1). Parents
 * keep the conditional-mount pattern ({open && <Drawer …>}). */
export function Drawer({ onClose, title, children }: DrawerProps) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-labelledby={title ? titleId : undefined}
        className="absolute inset-y-0 right-0 flex w-[440px] max-w-full flex-col border-l border-border bg-surface shadow-xl shadow-black/40"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-ink-primary">
            {title}
          </h2>
          <button
            className="shrink-0 rounded-md p-1 text-ink-muted hover:bg-white/10 hover:text-ink-primary"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
