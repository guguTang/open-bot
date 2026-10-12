import { Copy, Flag, MoreHorizontal, Reply, Smile } from "lucide-react";

const stroke = {
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

/** Outline icons aligned with Grok Bot / Cursor chat chrome. */
export function IconSmile({ size = 16 }: { size?: number }) {
  return <Smile size={size} {...stroke} />;
}

export function IconReply({ size = 16 }: { size?: number }) {
  return <Reply size={size} {...stroke} />;
}

export function IconMore({ size = 16 }: { size?: number }) {
  return <MoreHorizontal size={size} {...stroke} />;
}

export function IconCopy({ size = 16 }: { size?: number }) {
  return <Copy size={size} {...stroke} />;
}

export function IconFlag({ size = 16 }: { size?: number }) {
  return <Flag size={size} {...stroke} />;
}
