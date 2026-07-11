import { useState, type ComponentType } from "react";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Cleaner } from "./Cleaner";
import { HardwareInfo } from "./HardwareInfo";
import { Services } from "./Services";
import { Startup } from "./Startup";
import { Uninstaller } from "./Uninstaller";

const TABS: { id: string; label: string; Component: ComponentType }[] = [
  { id: "services", label: "Services", Component: Services },
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
        <SegmentedControl
          options={TABS.map((t) => ({ value: t.id, label: t.label }))}
          value={active}
          onChange={setActive}
        />
      </div>
      <div className="min-h-0 flex-1">
        <Component />
      </div>
    </div>
  );
}
