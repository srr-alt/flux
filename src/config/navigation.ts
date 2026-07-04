import {
  Activity,
  Server,
  ListTree,
  Settings2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PageId = "fleet" | "performance" | "processes" | "tools" | "settings";

export interface NavEntry {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

export const NAVIGATION: NavEntry[] = [
  { id: "fleet", label: "Fleet", icon: Server },
  { id: "performance", label: "Performance", icon: Activity },
  { id: "processes", label: "Processes", icon: ListTree },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: Settings2 },
];
