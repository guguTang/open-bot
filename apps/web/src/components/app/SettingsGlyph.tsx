import {
  BookOpen,
  Clock,
  Cpu,
  KeyRound,
  List,
  Monitor,
  Package,
  Plug,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import type { SettingsTab } from "../../types/app-ui";

const iconProps = {
  size: 16,
  strokeWidth: 1.8,
  "aria-hidden": true as const,
};

export function SettingsGlyph({ id }: { id: SettingsTab }) {
  switch (id) {
    case "general":
      return <Settings {...iconProps} />;
    case "bot":
      return <User {...iconProps} />;
    case "machines":
      return <Monitor {...iconProps} />;
    case "sandbox":
      return <Package {...iconProps} />;
    case "llm":
      return <Cpu {...iconProps} />;
    case "skills":
      return <BookOpen {...iconProps} />;
    case "mcp":
      return <Plug {...iconProps} />;
    case "compact":
      return <List {...iconProps} />;
    case "routines":
      return <Clock {...iconProps} />;
    case "secrets":
      return <KeyRound {...iconProps} />;
    case "review":
      return <ShieldCheck {...iconProps} />;
  }
}
