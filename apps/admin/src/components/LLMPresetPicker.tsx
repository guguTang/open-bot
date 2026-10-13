import type { ReactNode } from "react";
import { Typography } from "antd";
import {
  LLM_PRESET_GROUPS,
  LLM_PRESETS,
  type LLMPreset,
  type LLMPresetGroup,
} from "../llmPresets";

const { Text } = Typography;

export interface LLMPresetPickerProps {
  selectedId: string | null;
  onSelect: (preset: LLMPreset | null) => void;
}

function PresetCard({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: 88,
        minHeight: 76,
        padding: "10px 8px",
        borderRadius: 10,
        border: selected ? "1.5px solid #1677ff" : "1px solid #e5e5e5",
        background: selected ? "#e6f4ff" : "#fff",
        boxShadow: selected ? "0 0 0 1px rgba(22,119,255,0.15)" : "none",
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
      }}
    >
      {children}
      <span style={{ fontSize: 12, lineHeight: 1.2, textAlign: "center" }}>{label}</span>
    </button>
  );
}

function GroupSection({
  group,
  selectedId,
  onSelect,
}: {
  group: LLMPresetGroup;
  selectedId: string | null;
  onSelect: (preset: LLMPreset | null) => void;
}) {
  const label = LLM_PRESET_GROUPS.find((g) => g.id === group)?.label ?? group;
  const items = LLM_PRESETS.filter((p) => p.group === group);
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
        {label}
      </Text>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((preset) => {
          const Icon = preset.Icon;
          return (
            <PresetCard
              key={preset.id}
              selected={selectedId === preset.id}
              label={preset.name}
              onClick={() => onSelect(preset)}
            >
              <Icon.Avatar size={28} shape="square" />
            </PresetCard>
          );
        })}
      </div>
    </div>
  );
}

export function LLMPresetPicker({ selectedId, onSelect }: LLMPresetPickerProps) {
  return (
    <div style={{ marginBottom: 20, maxWidth: 560 }}>
      <Text strong style={{ display: "block", marginBottom: 4 }}>
        常用模型
      </Text>
      <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
        点选后自动填入 Base URL；名称与模型在为空或仍为上一预设建议值时才会覆盖。
      </Text>
      {LLM_PRESET_GROUPS.map((g) => (
        <GroupSection
          key={g.id}
          group={g.id}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <PresetCard
          selected={selectedId === null}
          label="自定义"
          onClick={() => onSelect(null)}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "#f5f5f5",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: "#8c8c8c",
            }}
          >
            …
          </span>
        </PresetCard>
      </div>
    </div>
  );
}
