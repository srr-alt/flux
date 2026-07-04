import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";

const win = getCurrentWindow();

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // The `data-tauri-drag-region` attribute alone doesn't reliably move an
  // undecorated window on Linux/GTK — wiring startDragging() explicitly does.
  const onMouseDown = (e: React.MouseEvent) => {
    // Mousedown on the window buttons bubbles up here; startDragging()
    // would grab the pointer and the button's click event never fires.
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.buttons === 1) {
      if (e.detail === 2) {
        win.toggleMaximize();
      } else {
        win.startDragging();
      }
    }
  };

  return (
    <div
      onMouseDown={onMouseDown}
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface pl-3"
    >
      <span className="pointer-events-none text-xs font-medium text-ink-muted">
        Flux
      </span>
      <div className="flex h-full">
        <button
          onClick={() => win.minimize()}
          className="flex h-full w-11 items-center justify-center text-ink-muted hover:bg-white/10 hover:text-ink-primary"
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="flex h-full w-11 items-center justify-center text-ink-muted hover:bg-white/10 hover:text-ink-primary"
          aria-label="Maximize"
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => win.close()}
          className="flex h-full w-11 items-center justify-center text-ink-muted hover:bg-status-critical hover:text-white"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
