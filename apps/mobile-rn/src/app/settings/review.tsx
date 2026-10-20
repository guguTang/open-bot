/**
 * 审核 · 始终允许。对齐 Web `ReviewSettingsTab`：
 * 列出本地点过「始终允许」的操作族，可撤销；服务端 API 就绪后合并远程。
 */

import { Button, Card, ListGroup, Separator, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { useConfirm } from "@/components/ConfirmDialog";
import { FormStatus, PageIntro } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatDateTime } from "@/lib/format";
import {
  REVIEW_EMPTY_COPY,
  listToolAllowEntries,
  loadMergedAllowlist,
  revokeAllowlistEntry,
  type ToolAllowEntry,
} from "@/lib/hostApproval";
import { useSession } from "@/providers/session";
import { runWithFinally } from "@/lib/finally";

export default function ReviewSettingsScreen(): JSX.Element {
  const { user } = useSession();
  const { confirm } = useConfirm();
  const userId = user?.id || "";

  const [entries, setEntries] = useState<ToolAllowEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const { entries: next } = await loadMergedAllowlist(userId);
    setEntries(next);
  }, [userId]);

  useEffect(() => {
    setEntries(listToolAllowEntries(userId));
    void refresh();
  }, [userId, refresh]);

  async function onRevoke(entry: ToolAllowEntry): Promise<void> {
    const okConfirm = await confirm({
      title: "撤销始终允许？",
      message: `之后「${entry.label}」类操作会再次请求确认。`,
      confirmLabel: "撤销",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!okConfirm) return;

    setBusy(true);
    setMsg("");
    await runWithFinally(
      async () => {
        const { entries: next } = await revokeAllowlistEntry(userId, entry);
        setEntries(next);
        setMsg("已撤销，下次将再次询问");
      },
      () => {
        setBusy(false);
      }
    );
  }

  return (
    <ScreenScaffold
      title="审核"
      subtitle="始终允许的操作"
      loading={false}
      error={null}
      onRetry={() => void refresh()}
    >
      <PageIntro>这里是你点过「始终允许」的操作。撤销后，同类操作会再次请求确认。</PageIntro>

      {entries.length === 0 ? (
        <EmptyState title={REVIEW_EMPTY_COPY} />
      ) : (
        <Card className="overflow-hidden p-0">
          <ListGroup>
            {entries.map((entry, index) => (
              <View key={entry.family}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{entry.label}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {[entry.tool, entry.granted_at ? formatDateTime(entry.granted_at) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      isDisabled={busy}
                      onPress={() => void onRevoke(entry)}
                    >
                      <Button.Label>撤销</Button.Label>
                    </Button>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </View>
            ))}
          </ListGroup>
        </Card>
      )}

      <FormStatus message={msg} />
      <Typography.Paragraph color="muted" className="mt-2 text-xs">
        本地与远端条目会自动合并；远端优先。
      </Typography.Paragraph>
    </ScreenScaffold>
  );
}
