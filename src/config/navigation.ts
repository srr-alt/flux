import {
  Activity,
  Container,
  Server,
  ListTree,
  Settings2,
  Thermometer,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PageId =
  | "fleet"
  | "performance"
  | "processes"
  | "sensors"
  | "docker"
  | "tools"
  | "settings";

export interface NavEntry {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

export const NAVIGATION: NavEntry[] = [
  { id: "fleet", label: "Fleet", icon: Server },
  { id: "performance", label: "Performance", icon: Activity },
  { id: "processes", label: "Processes", icon: ListTree },
  { id: "sensors", label: "Sensors", icon: Thermometer },
  { id: "docker", label: "Docker", icon: Container },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: Settings2 },
];
