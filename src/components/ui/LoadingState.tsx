import { RefreshCw } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Shared centered spinner + label for page/table loading. */
export function LoadingState({ label = "Loading…", className = "" }: LoadingStateProps) {
  return (
    <div
      className={`flex items-center justify-center gap-2 p-6 text-sm text-ink-muted ${className}`}
    >
      <RefreshCw size={14} className="animate-spin" />
      {label}
    </div>
  );
}
