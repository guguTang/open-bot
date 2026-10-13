/**
 * 服务器地址。对齐 Web `ApiServerField`（settings 变体）：
 * 编辑 API base → 健康探测 → 保存到 AsyncStorage。
 */

import { Button } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";

import {
  DEFAULT_API_BASE,
  formatApiHealthProbe,
  getApiBase,
  probeApiHealth,
  setApiBase,
  type ApiHealthProbeResult,
} from "@/api/config";
import { FormActions, FormField, FormStatus, PageIntro } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";

export default function ServerSettingsScreen(): JSX.Element {
  const [draft, setDraft] = useState(() => getApiBase());
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<ApiHealthProbeResult | null>(null);

  async function runProbe(url: string): Promise<ApiHealthProbeResult> {
    setBusy(true);
    setProbe(null);
    try {
      const result = await probeApiHealth(url);
      setProbe(result);
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    const next = draft.trim() || DEFAULT_API_BASE;
    const result = await runProbe(next);
    if (!result.ok) return;
    const applied = setApiBase(next);
    setDraft(applied);
  }

  function resetDefault(): void {
    setDraft(DEFAULT_API_BASE);
    setProbe(null);
  }

  const draftNorm = draft.trim().replace(/\/+$/, "");

  return (
    <ScreenScaffold title="服务器" subtitle="API 地址 · 局域网 / 隧道配对">
      <PageIntro>
        与电脑同一局域网，或填 ngrok 等 https 隧道。改地址后先「检测连接」，通过再保存；切换后保留本机登录态，连不上请退出重登。
      </PageIntro>

      <FormField
        label="服务器地址"
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setProbe(null);
        }}
        placeholder={DEFAULT_API_BASE}
        keyboardType="url"
        autoCapitalize="none"
        editable={!busy}
        hint={`当前：${getApiBase()}`}
      />

      <FormActions>
        <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void runProbe(draft)}>
          <Button.Label>{busy ? "检测中…" : "检测连接"}</Button.Label>
        </Button>
        <Button size="sm" isDisabled={busy} onPress={() => void apply()}>
          <Button.Label>保存并使用</Button.Label>
        </Button>
        {draftNorm !== DEFAULT_API_BASE ? (
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={resetDefault}>
            <Button.Label>恢复默认</Button.Label>
          </Button>
        ) : null}
      </FormActions>

      {probe ? (
        <FormStatus message={formatApiHealthProbe(probe)} tone={probe.ok ? "success" : "danger"} />
      ) : null}
    </ScreenScaffold>
  );
}
