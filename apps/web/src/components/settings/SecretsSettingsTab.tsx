import type { FormEvent } from "react";
import type { BotSecretMeta, BotSecretRequest } from "../../api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
          <form onSubmit={onSubmitSecret}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="secret-name">名称</FieldLabel>
                <Input
                  id="secret-name"
                  value={secretFormName}
                  onChange={(e) => setSecretFormName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="secret-origin">Origin (HTTPS)</FieldLabel>
                <Input
                  id="secret-origin"
                  value={secretFormOrigin}
                  onChange={(e) => setSecretFormOrigin(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="secret-value">值</FieldLabel>
                <Input
                  id="secret-value"
                  type="password"
                  value={secretFormValue}
                  onChange={(e) => setSecretFormValue(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">添加密钥</Button>
              </div>
            </FieldGroup>
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
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void onDeleteSecret(s.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {secretRequests.length ? (
          <p className="settings-status m-0">待处理请求：{secretRequests.length}</p>
        ) : null}
        {secretMsg ? <p className="settings-status m-0">{secretMsg}</p> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
