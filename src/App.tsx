import { useEffect, useState, type ComponentType } from "react";
import { AssistantPanel } from "./components/layout/AssistantPanel";
import { ResizeHandles } from "./components/layout/ResizeHandles";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
import type { PageId } from "./config/navigation";
import { useFleetEvents } from "./hooks/useFleetEvents";
import { useMonitorTick } from "./hooks/useMonitorTick";
import { LOCAL_HOST_ID, useHostsStore } from "./state/hostsStore";
import { useLockStore } from "./state/lockStore";
import { Alerts } from "./pages/Alerts";
import { Docker } from "./pages/Docker";
import { Fleet } from "./pages/Fleet";
import { Performance } from "./pages/Performance";
import { Processes } from "./pages/Processes";
import { Sensors } from "./pages/Sensors";
import { Settings } from "./pages/Settings";
import { Tools } from "./pages/Tools";

const PAGES: Record<PageId, ComponentType<{ onNavigate?: (page: PageId) => void }>> = {
  fleet: Fleet,
  performance: Performance,
  processes: Processes,
  sensors: Sensors,
  alerts: Alerts,
  docker: Docker,
  tools: Tools,
  settings: Settings,
};

function App() {
  useMonitorTick();
  useFleetEvents();
  const [page, setPage] = useState<PageId>("performance");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const locked = useLockStore((s) => s.locked);
  // Privacy lock hides Fleet and Alerts — bounce to Performance if it
  // engages there, and pin the machine picker to local so no remote data
  // shows anywhere.
  const activePage =
    locked && (page === "fleet" || page === "alerts") ? "performance" : page;
  const Page = PAGES[activePage];

  useEffect(() => {
    if (locked) useHostsStore.getState().setSelected(LOCAL_HOST_ID);
  }, [locked]);

  return (
    <main className="relative isolate flex h-screen w-screen flex-col overflow-hidden bg-page">
      {/* ambient glow layer — the glass panels' backdrop blur picks this up */}
      <div className="pointer-events-none absolute -left-24 -top-40 -z-10 h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(94,106,210,.09),transparent_72%)] blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-44 right-20 -z-10 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(94,106,210,.06),transparent_72%)] blur-[100px]" />
      {/* star field: one dot cloned via box-shadow, slow twinkle */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 h-px w-px animate-twinkle opacity-60"
        style={{
          boxShadow:
            "62px 84px 0 rgba(255,255,255,.5), 143px 220px 0 rgba(255,255,255,.35), 238px 46px 0 rgba(255,255,255,.4), 331px 310px 0 rgba(255,255,255,.3), 410px 130px 0 rgba(255,255,255,.45), 512px 380px 0 rgba(255,255,255,.3), 590px 90px 0 rgba(255,255,255,.35), 675px 260px 0 rgba(255,255,255,.4), 760px 40px 0 rgba(255,255,255,.3), 820px 340px 0 rgba(255,255,255,.35), 120px 400px 0 rgba(255,255,255,.3), 280px 470px 0 rgba(255,255,255,.4)",
        }}
      />
      <ResizeHandles />
      <TitleBar
        page={page}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={activePage} onNavigate={setPage} />
        {/* key remounts on nav: plays the entrance animation and resets scroll */}
        <div key={activePage} className="min-w-0 flex-1 animate-page-in overflow-y-auto">
          <Page onNavigate={setPage} />
        </div>
      </div>
      {assistantOpen && !locked && (
        <AssistantPanel onClose={() => setAssistantOpen(false)} />
      )}
    </main>
  );
}

export default App;
