import { create } from "zustand";

/** Which host the terminal slide-over is open on; null = closed. Opened
 * from the Fleet tiles, the Ctrl+` hotkey, and anywhere else that has a
 * host id. */
interface TerminalState {
  hostId: string | null;
  open: (hostId: string) => void;
  close: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  hostId: null,
  open: (hostId) => set({ hostId }),
  close: () => set({ hostId: null }),
}));
