import { useState, type ComponentType } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import type { PageId } from "./config/navigation";
import { useMonitorTick } from "./hooks/useMonitorTick";
import { Performance } from "./pages/Performance";
import { Processes } from "./pages/Processes";
import { Settings } from "./pages/Settings";
import { Tools } from "./pages/Tools";

const PAGES: Record<PageId, ComponentType> = {
  performance: Performance,
  processes: Processes,
  tools: Tools,
  settings: Settings,
};

function App() {
  useMonitorTick();
  const [page, setPage] = useState<PageId>("performance");
  const Page = PAGES[page];

  return (
    <main className="flex h-screen w-screen bg-page">
      <Sidebar active={page} onNavigate={setPage} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Page />
      </div>
    </main>
  );
}

export default App;
