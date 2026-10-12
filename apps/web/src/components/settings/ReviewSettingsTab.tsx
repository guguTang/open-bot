import { REVIEW_EMPTY_COPY, type ToolAllowEntry } from "../../lib/toolAllowlist";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type ReviewSettingsTabProps = {
  toolAllowEntries: ToolAllowEntry[];
  toolAllowBusy: boolean;
  toolAllowServerOk: boolean;
  onRevokeEntry: (entry: ToolAllowEntry) => void;
};

export function ReviewSettingsTab({
  toolAllowEntries,
  toolAllowBusy,
  toolAllowServerOk,
  onRevokeEntry,
}: ReviewSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsSection title="始终允许">
        <SettingsHint>
          这里是你点过「始终允许」的操作。撤销后，同类操作会再次请求确认。
        </SettingsHint>
        <SettingsCard>
          {toolAllowEntries.length === 0 ? (
            <SettingsEmpty>{REVIEW_EMPTY_COPY}</SettingsEmpty>
          ) : (
            <ul className="review-allow-list" aria-label="始终允许的操作">
              {toolAllowEntries.map((entry) => (
                <li key={entry.family} className="review-allow-row">
                  <div className="review-allow-main">
                    <span className="review-allow-name">{entry.label}</span>
                    {entry.tool ? (
                      <span className="review-allow-sub">{entry.tool}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="settings-pill review-allow-revoke"
                    disabled={toolAllowBusy}
                    onClick={() => onRevokeEntry(entry)}
                  >
                    撤销
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
        {!toolAllowServerOk ? (
          <SettingsHint>
            列表暂存在本机；服务端 allowlist API 就绪后将自动同步。
          </SettingsHint>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}
