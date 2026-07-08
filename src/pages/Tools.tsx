import { useState, type ComponentType } from "react";
import { Cleaner } from "./Cleaner";
import { Docker } from "./Docker";
import { HardwareInfo } from "./HardwareInfo";
import { Services } from "./Services";
import { Startup } from "./Startup";
import { Uninstaller } from "./Uninstaller";

const TABS: { id: string; label: string; Component: ComponentType }[] = [
  { id: "services", label: "Services", Component: Services },
  { id: "docker", label: "Docker", Component: Docker },
  { id: "startup", label: "Startup Apps", Component: Startup },
  { id: "cleaner", label: "Cleaner", Component: Cleaner },
  { id: "uninstaller", label: "Uninstaller", Component: Uninstaller },
  { id: "hardware", label: "System Info", Component: HardwareInfo },
];

export function Tools() {
  const [active, setActive] = useState("services");
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];
  const Component = tab.Component;

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-5">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`rounded-[7px] px-3 py-1 text-[13px] transition-colors duration-100 ${
                t.id === active
                  ? "bg-series-1/15 font-medium text-series-1"
                  : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Component />
      </div>
    </div>
  );
}
