import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  onClose: () => void;
  /** Rendered as the dialog heading; also wires aria-labelledby. */
  title?: ReactNode;
  /** Tailwind width class for the panel. */
  width?: string;
  /** Close on overlay click. */
  closeOnOverlay?: boolean;
  /** false disables Esc/overlay/X while an operation is in flight. */
  dismissable?: boolean;
  /** Show an X button in the top-right corner. */
  showClose?: boolean;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared dialog: overlay, Esc close, focus trap, focus restore, aria. Parents
 * keep the conditional-mount pattern ({open && <Modal …>}). */
export function Modal({
  onClose,
  title,
  width = "w-96",
  closeOnOverlay = true,
  dismissable = true,
  showClose = false,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;
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
      if (e.key === "Escape" && dismissableRef.current) {
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
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (closeOnOverlay && dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative max-h-[85vh] animate-pop-in overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl shadow-black/40 outline-none ${width}`}
      >
        {showClose && (
          <button
            className="absolute right-3 top-3 rounded-md p-1 text-ink-muted hover:bg-white/10 hover:text-ink-primary disabled:opacity-40"
            onClick={onClose}
            disabled={!dismissable}
            aria-label="Close dialog"
          >
            <X size={14} />
          </button>
        )}
        {title && (
          <h2 id={titleId} className="mb-3 pr-6 text-sm font-semibold text-ink-primary">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
