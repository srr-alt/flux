import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getHostStatuses,
  listHosts,
  onHostStatus,
  onRemoteDisks,
  onRemoteTick,
} from "../lib/tauri";
import { useFleetStore } from "../state/fleetStore";
import { useHostsStore } from "../state/hostsStore";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Mounted once in App. Feeds host statuses and remote snapshots into the
 * hosts/fleet stores. Saved hosts auto-connect on the Rust side at startup.
 */
export function useFleetEvents() {
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    listHosts()
      .then((hosts) => {
        if (!cancelled) useHostsStore.getState().setHosts(hosts);
      })
      .catch(() => {});

    // Seed current statuses — status events only fire on transitions, so a
    // freshly loaded window would otherwise show every host as offline.
    getHostStatuses()
      .then((statuses) => {
        if (cancelled) return;
        for (const event of Object.values(statuses)) {
          useHostsStore
            .getState()
            .upsertStatus(event.host_id, event.status, event.system_info);
        }
      })
      .catch(() => {});

    const subscribe = async () => {
      const subs = await Promise.all([
        // Host list edited outside the UI (local HTTP API) — re-fetch.
        listen("hosts://changed", async () => {
          useHostsStore.getState().setHosts(await listHosts());
        }),
        onHostStatus((event) => {
          useHostsStore
            .getState()
            .upsertStatus(event.host_id, event.status, event.system_info);
        }),
        onRemoteTick((event) => {
          useFleetStore.getState().pushTick(event.host_id, event.snapshot);
        }),
        onRemoteDisks((event) => {
          useFleetStore.getState().pushDisks(event.host_id, event.snapshot);
        }),
      ]);
      if (cancelled) {
        subs.forEach((fn) => fn());
      } else {
        unlistens.push(...subs);
      }
    };
    subscribe();

    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);
}
