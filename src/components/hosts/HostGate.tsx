import { useRef } from "react";
import { WifiOff } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { useSelectedHostStatus } from "../../hooks/useHostMetrics";

/** Blocks a page's content while the selected remote host isn't delivering
 * data: spinner on first connect, "disconnected" card once it drops. The
 * poller cycles connecting→error while retrying, so after a failure the card
 * stays up through reconnect attempts instead of flickering to a spinner. */
export function HostGate({ children }: { children: React.ReactNode }) {
  const selected = useSelectedHostStatus();
  // Last failure message per gate instance; cleared on connect.
  const failedRef = useRef<string | null>(null);

  if (!selected) return <>{children}</>;

  const { status, name } = selected;
  if (status.state === "connected" || status.state === "degraded") {
    failedRef.current = null;
    return <>{children}</>;
  }

  if (status.state === "error") {
    failedRef.current = status.message;
  } else if (status.state === "disconnected") {
    failedRef.current = "Connection closed.";
  }

  if (status.state === "connecting" && failedRef.current === null) {
    return <LoadingState label={`Connecting to ${name}…`} className="h-full" />;
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={WifiOff}
        title={`${name} is disconnected`}
        hint={
          <>
            {failedRef.current}
            <span className="mt-1 block">
              Retrying automatically — live data resumes when the connection
              comes back.
            </span>
          </>
        }
        className="w-full max-w-md"
      />
    </div>
  );
}
