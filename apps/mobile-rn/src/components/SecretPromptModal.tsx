import { Button, Dialog, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { BotSecretRequest } from "@/api/types";
import { FormField } from "@/components/FormField";

type Props = {
  request: BotSecretRequest | null;
  onClose: () => void;
  onResolved: () => void;
};

/**
 * 助手的密钥授权弹窗。
 *
 * 助手在对话里调用 `request_secret` 时会挂起一条请求，用户在这里补值。
 * 对齐 `apps/web/src/components/SecretPromptModal.tsx`：保存 = 提交明文，
 * 忽略 = dismiss，两种都要通知外层刷新列表。
 */
export function SecretPromptModal({ request, onClose, onResolved }: Props): JSX.Element {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      await api.resolveBotSecretRequest(request.id, {
        value,
        name: request.name,
        origin: request.origin,
        auth_type: request.auth_type,
        agent_id: request.agent_id,
      });
      setValue("");
      onResolved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (): Promise<void> => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      await api.resolveBotSecretRequest(request.id, { dismiss: true });
      onResolved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={request !== null} onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress>
          <Dialog.Content>
            <Dialog.Title numberOfLines={2}>需要密钥：{request?.name || "secret"}</Dialog.Title>
            <Dialog.Description>
              {request?.reason || "助手请求一个密钥。明文仅加密存库，不会回传给模型。"}
            </Dialog.Description>

            {request?.origin ? (
              <Typography.Paragraph color="muted" className="mt-2 text-xs">
                Origin：{request.origin}
              </Typography.Paragraph>
            ) : null}

            <View className="mt-3">
              <FormField
                label="密钥值"
                value={value}
                onChangeText={setValue}
                placeholder="粘贴 token / API key"
                error={err}
              />
            </View>

            <View className="mt-4 flex-row justify-end gap-3">
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onPress={() => void dismiss()}
              >
                <Button.Label>忽略</Button.Label>
              </Button>
              <Button size="sm" isDisabled={busy || !value.trim()} onPress={() => void submit()}>
                {busy ? <Spinner size="sm" /> : null}
                <Button.Label>保存</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}
