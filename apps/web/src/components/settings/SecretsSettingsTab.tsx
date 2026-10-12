import type { FormEvent } from "react";
import type { BotSecretMeta, BotSecretRequest } from "../../api";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type SecretsSettingsTabProps = {
  secretFormName: string;
  setSecretFormName: (v: string) => void;
  secretFormOrigin: string;
  setSecretFormOrigin: (v: string) => void;
  secretFormValue: string;
  setSecretFormValue: (v: string) => void;
  botSecrets: BotSecretMeta[];
  secretRequests: BotSecretRequest[];
  secretMsg: string;
  onSubmitSecret: (e: FormEvent) => void | Promise<void>;
  onDeleteSecret: (id: string) => void | Promise<void>;
};

export function SecretsSettingsTab({
  secretFormName,
  setSecretFormName,
  secretFormOrigin,
  setSecretFormOrigin,
  secretFormValue,
  setSecretFormValue,
  botSecrets,
  secretRequests,
  secretMsg,
  onSubmitSecret,
  onDeleteSecret,
}: SecretsSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        仅存元数据与密文；列表接口永不返回明文。需在服务端配置加密密钥。
      </SettingsHint>
      <SettingsSection title="添加密钥">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onSubmitSecret}>
            <label>
              名称
              <input value={secretFormName} onChange={(e) => setSecretFormName(e.target.value)} />
            </label>
            <label>
              Origin (HTTPS)
              <input value={secretFormOrigin} onChange={(e) => setSecretFormOrigin(e.target.value)} />
            </label>
            <label>
              值
              <input
                type="password"
                value={secretFormValue}
                onChange={(e) => setSecretFormValue(e.target.value)}
              />
            </label>
            <div className="llm-actions">
              <button type="submit" className="primary">
                添加密钥
              </button>
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="已保存">
        <SettingsCard>
          <div className="llm-list">
            {botSecrets.length === 0 ? (
              <SettingsEmpty>暂无密钥。</SettingsEmpty>
            ) : (
              botSecrets.map((s) => (
                <div key={s.id} className="llm-item">
                  <div>
                    <div className="agent-name">{s.name}</div>
                    <div className="agent-desc">
                      {s.origin || "(no origin)"} · {s.auth_type}
                    </div>
                  </div>
                  <div className="llm-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void onDeleteSecret(s.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {secretRequests.length ? (
          <div className="settings-status">待处理请求：{secretRequests.length}</div>
        ) : null}
        {secretMsg ? <div className="settings-status">{secretMsg}</div> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
