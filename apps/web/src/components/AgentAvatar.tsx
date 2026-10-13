import { cn } from "@/lib/utils";
import { RobotHead } from "robot-heads";
import {
  avatarSeed01,
  deriveScreenColor,
  deriveTrimColor,
  presenceToRobotState,
  resolveAvatarColor,
  resolveAvatarShape,
  type BotPresenceStatus,
} from "./avatarColor";

type Props = {
  id?: string;
  name: string;
  size?: number;
  className?: string;
  shape?: string | null;
  color?: string | null;
  status?: BotPresenceStatus | string;
  /**
   * §8 working-animation variant only: when product status maps to `working`
   * and this is true, RobotHead renders `state="searching"`. Does not change
   * product presence / CSS `status-*` class (stays working).
   */
  searchingHint?: boolean;
  /** Green online dot (bottom-right): server-computed bot online, independent of status face. */
  online?: boolean;
  onClick?: () => void;
  title?: string;
};

export function AgentAvatar({
  id,
  name,
  size = 28,
  className = "",
  shape,
  color,
  status = "idle",
  searchingHint = false,
  online = false,
  onClick,
  title,
}: Props) {
  const seedKey = id || name;
  const bg = resolveAvatarColor(seedKey, color);
  const sh = resolveAvatarShape(seedKey, shape);
  const robotState = presenceToRobotState(status, searchingHint);
  const clickable = Boolean(onClick);
  const seed = avatarSeed01(seedKey);
  const small = size <= 32;
  const trimColor = deriveTrimColor(bg);
  const screenColor = deriveScreenColor(bg);
  const dotPx = Math.max(6, Math.min(8, Math.round(size * 0.22)));

  const face = (
    <>
      <RobotHead
        shape={sh}
        state={robotState}
        size={size}
        color={bg}
        trimColor={trimColor}
        screenColor={screenColor}
        antenna={!small}
        floorShadow={!small}
        interactive={false}
        seed={seed}
        aria-hidden
      />
      {online ? (
        <span
          className="pointer-events-none absolute -bottom-px -right-px z-[2] box-border rounded-full border-[1.5px] border-[var(--panel,#fff)] bg-[#22c55e]"
          style={{ width: dotPx, height: dotPx }}
          aria-hidden
        />
      ) : null}
    </>
  );

  const wrapClass = cn(
    "agent-avatar-wrap relative inline-flex shrink-0 items-center justify-center overflow-visible border-0 bg-transparent p-0 leading-none",
    clickable ? "cursor-pointer" : "cursor-default",
    "disabled:cursor-default",
    "[&>span]:block [&>span]:leading-none",
    className,
  );
  // Slightly taller than size so hops/antenna glow are less clipped by tight parents;
  // RobotHead's layout box stays `size`×`size` inside.
  const wrapStyle = { width: size, height: size };

  if (clickable) {
    return (
      <button
        type="button"
        className={wrapClass}
        style={wrapStyle}
        onClick={onClick}
        title={title || `设置 ${name}`}
        aria-label={`设置 ${name} 形象`}
      >
        {face}
      </button>
    );
  }

  return (
    <span className={wrapClass} style={wrapStyle} title={title || name} aria-hidden>
      {face}
    </span>
  );
}
