import { useState, type ComponentType } from "react";
import { ResizeHandles } from "./components/layout/ResizeHandles";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
import type { PageId } from "./config/navigation";
import { useFleetEvents } from "./hooks/useFleetEvents";
import { useMonitorTick } from "./hooks/useMonitorTick";
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
  docker: Docker,
  tools: Tools,
  settings: Settings,
};

function App() {
  useMonitorTick();
  useFleetEvents();
  const [page, setPage] = useState<PageId>("performance");
  const Page = PAGES[page];

  return (
    <main className="flex h-screen w-screen flex-col bg-page">
      <ResizeHandles />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={page} onNavigate={setPage} />
        {/* key remounts on nav: plays the entrance animation and resets scroll */}
        <div key={page} className="min-w-0 flex-1 animate-page-in overflow-y-auto">
          <Page onNavigate={setPage} />
        </div>
      </div>
    </main>
  );
}

export default App;
