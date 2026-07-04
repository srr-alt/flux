import { create } from "zustand";
import type { HostStatus, HostView } from "../types/hosts";
import type { SystemInfo } from "../types/monitor";

/** The local machine is always present and is not a HostView entry. */
export const LOCAL_HOST_ID = "local";

interface HostsState {
  hosts: HostView[];
  statuses: Record<string, HostStatus>;
  systemInfos: Record<string, SystemInfo>;
  selectedHostId: string;
  setHosts: (hosts: HostView[]) => void;
  upsertStatus: (
    hostId: string,
    status: HostStatus,
    systemInfo?: SystemInfo,
  ) => void;
  removeHost: (hostId: string) => void;
  setSelected: (hostId: string) => void;
}

export const useHostsStore = create<HostsState>((set) => ({
  hosts: [],
  statuses: {},
  systemInfos: {},
  selectedHostId: LOCAL_HOST_ID,
  setHosts: (hosts) => set({ hosts }),
  upsertStatus: (hostId, status, systemInfo) =>
    set((state) => ({
      statuses: { ...state.statuses, [hostId]: status },
      systemInfos: systemInfo
        ? { ...state.systemInfos, [hostId]: systemInfo }
        : state.systemInfos,
    })),
  removeHost: (hostId) =>
    set((state) => {
      const statuses = { ...state.statuses };
      const systemInfos = { ...state.systemInfos };
      delete statuses[hostId];
      delete systemInfos[hostId];
      return {
        hosts: state.hosts.filter((h) => h.id !== hostId),
        statuses,
        systemInfos,
        selectedHostId:
          state.selectedHostId === hostId ? LOCAL_HOST_ID : state.selectedHostId,
      };
    }),
  setSelected: (hostId) => set({ selectedHostId: hostId }),
}));
