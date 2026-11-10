import { GitBranch, Hash, Mail, MessagesSquare, Send } from "lucide-react";
import type { ConnectAppId } from "../../lib/connectApps/catalog";
import { cn } from "@/lib/utils";

const ICONS = {
  gmail: Mail,
  slack: Hash,
  telegram: Send,
  feishu: MessagesSquare,
  github: GitBranch,
} as const;

/** Brand tile for a real provider. Color lives in CSS (`data-app`), not a new theme. */
export function ConnectAppMark({ id, size = "md" }: { id: ConnectAppId; size?: "md" | "sm" }) {
  const Icon = ICONS[id];
  return (
    <span className={cn("connect-app-mark", size === "sm" && "connect-app-mark--sm")} data-app={id} aria-hidden>
      <Icon strokeWidth={2} />
    </span>
  );
}
