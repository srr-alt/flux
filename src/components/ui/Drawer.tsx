import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** 720px instead of the default 440px — for logs, terminals, wide tables. */
  wide?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Right-hand slide-over: lighter than Modal — the page stays visible for
 * context. Esc/backdrop close, focus trap + restore. Parents keep the
 * conditional-mount pattern ({open && <Drawer …>}). */
export function Drawer({ onClose, title, children, wide }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;

    const initial =
      panel.querySelector<HTMLElement>("[autofocus]") ??
      panel.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
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
      className="fixed inset-0 z-50 animate-fade-in bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`glass-overlay absolute inset-y-0 right-0 flex max-w-full animate-drawer-in flex-col border-l border-white/10 shadow-[-16px_0_48px_rgba(0,0,0,.5),inset_1px_0_0_rgba(255,255,255,.04)] outline-none ${
          wide ? "w-[720px]" : "w-[440px]"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-ink-primary">
            {title}
          </h2>
          <button
            className="shrink-0 rounded-md p-1 text-ink-muted transition-colors duration-100 hover:bg-white/10 hover:text-ink-primary"
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
