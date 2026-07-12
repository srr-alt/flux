import { X, Minus } from "lucide-react";

/** Floating assistant pane (design "Flux Assistant"). The conversation is
 * the design's static preview — no model is wired up yet; the input is
 * display-only until a backend exists. */
export function AssistantPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="glass-overlay fixed bottom-4 right-4 z-[120] flex max-h-[min(72vh,620px)] w-[390px] origin-bottom-right animate-pop-in flex-col overflow-hidden rounded-[22px] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.04)]">
      {/* header */}
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border px-2.5">
        <span className="h-4 w-4 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#8b93e8,#5e6ad2_60%,#2a3070)]" />
        <span className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-ink-primary">
          Flux Assistant
        </span>
        <span className="shrink-0 whitespace-nowrap rounded-[5px] bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-faint">
          local · llama-70b
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Minimize assistant"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-muted hover:bg-white/10 hover:text-ink-secondary"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={onClose}
          aria-label="Close assistant"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-muted hover:bg-white/10 hover:text-ink-secondary"
        >
          <X size={12} />
        </button>
      </div>

      {/* conversation (design preview content) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 pb-1.5 pt-3.5 text-xs">
        <div className="text-[11px] text-ink-faint">
          connected to <span className="font-medium text-ink-muted">build-runner</span> · 3m ago
        </div>
        <div className="leading-normal text-ink-secondary">
          Detected a sustained CPU spike (
          <span className="font-medium text-status-critical">92%</span>) on{" "}
          <span className="font-mono text-[11.5px] font-medium text-ink-primary">
            build-runner
          </span>{" "}
          for the last 6 minutes.
        </div>

        <div className="border-t border-border pt-3">
          <div className="leading-normal text-ink-muted">
            <span className="font-semibold text-series-1">@Flux</span> what's causing this?
          </div>
        </div>

        <div>
          <div className="mb-1.5 font-medium text-ink-primary">Examining process tree…</div>
          <div className="mb-2.5 text-[11px] text-ink-faint">Worked for 6s ▾</div>
          <div className="mb-2 leading-relaxed text-ink-secondary">
            Top consumer is{" "}
            <span className="font-mono text-[11.5px] font-medium text-ink-primary">ci-runner</span>{" "}
            (node) — 4 workers pinned near 100%, 12-job backlog queued.
          </div>
          <div className="flex flex-col gap-1.5 pl-0.5 text-[11.5px] text-ink-muted">
            <div>
              · <span className="font-mono text-[11px] text-ink-secondary">ci-runner.service</span>{" "}
              — no memory ceiling set, workers queuing instead of throttling
            </div>
            <div>
              · <span className="font-mono text-[11px] text-ink-secondary">NODE_OPTIONS</span>{" "}
              missing{" "}
              <span className="font-mono text-[11px] text-ink-secondary">
                --max-old-space-size
              </span>
              , causing GC thrash
            </div>
          </div>
        </div>

        {/* suggested fix card */}
        <div className="mb-1 rounded-2xl border border-white/[.07] bg-terminal px-3 py-[11px]">
          <div className="mb-2 flex items-center">
            <span className="text-xs font-semibold text-ink-primary">Suggested fix</span>
            <span className="ml-2 font-mono text-[11px] font-medium">
              <span className="text-status-good">+2</span>{" "}
              <span className="text-status-critical">−0</span>
            </span>
            <button className="ml-auto rounded-full border border-white/12 px-3 py-1 text-[11px] font-medium text-ink-secondary hover:bg-white/10">
              Preview
            </button>
          </div>
          <div className="font-mono text-[11px] leading-[1.7]">
            <div className="text-status-good">+ NODE_OPTIONS=--max-old-space-size=4096</div>
            <div className="text-status-good">
              + MemoryMax=6G <span className="text-ink-faint">(ci-runner.service)</span>
            </div>
          </div>
          <div className="mt-2 font-mono text-[10.5px] text-ink-faint">
            build-runner ← ci-runner.service
          </div>
        </div>

        <button className="mb-2.5 self-start rounded-full bg-series-1 px-4 py-[7px] text-xs font-medium text-white transition-[background-color,transform] duration-100 hover:bg-[#6a76e0] active:scale-[.96]">
          Apply fix
        </button>
      </div>

      {/* input bar */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-2xl border border-white/[.08] bg-terminal px-2.5 py-2">
          <input
            placeholder="Ask Flux anything…"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink-primary outline-none placeholder:text-ink-faint"
          />
          <span className="cursor-pointer text-[13px] text-ink-faint">⤢</span>
          <span className="cursor-pointer text-[13px] text-ink-faint">📎</span>
          <button
            aria-label="Send"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-series-1 text-[11px] text-white"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
