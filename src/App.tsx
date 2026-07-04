import { useState, type ComponentType } from "react";
import { ResizeHandles } from "./components/layout/ResizeHandles";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
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
    <main className="flex h-screen w-screen flex-col bg-page">
      <ResizeHandles />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={page} onNavigate={setPage} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Page />
        </div>
      </div>
    </main>
  );
}

export default App;
