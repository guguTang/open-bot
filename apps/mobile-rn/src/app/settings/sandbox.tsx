import { Button, Card, Chip, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, View } from "react-native";

import * as api from "@/api";
import type { SandboxDirEntry } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { WebPreviewModal } from "@/components/chat/WebPreviewModal";
import { formatDateTime, formatSize } from "@/lib/format";
import { friendlyOpenError, normalizeWorkspacePath, previewTitleFromPath } from "@/lib/workspace";
import { useBusy, useSandbox, useSandboxMutations } from "@/queries";

/**
 * 运行环境（高级）。
 *
 * 对齐 Web 端 `settingsTab === "sandbox"`，但有一条产品硬要求：
 * **运行环境对用户是透明的**——UI 里不出现 docker / 容器 / 镜像 / 宿主机路径 / /workspace
 * 这类内部词汇，一律说「运行环境」「我的文件」。所以：
 * - container_id、image、workdir_host、computer_mode、desktop_port 全部不下发到 UI；
 * - checkpoint_path 是宿主机目录，只取文件名（previewTitleFromPath）展示；
 * - 文件路径在内部仍是 /workspace/...（后端约定），但界面只显示相对路径；
 * - 后端报错里的实现细节在展示前替换掉（publicError）。
 */

/** 后端 db.SandboxStatus* 的中文映射。未知值原样透出，避免把新状态显示成「未知」误导排查。 */
const STATUS_TEXT: Record<string, string> = {
  creating: "启动中",
  running: "运行中",
  stopped: "已停止",
  error: "异常",
};

function statusText(status?: string | null): string {
  if (!status) return "未知";
  return STATUS_TEXT[status] ?? status;
}

function statusChipColor(status?: string | null): "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "running":
      return "success";
    case "creating":
      return "warning";
    case "error":
      return "danger";
    default:
      return "default";
  }
}

/**
 * 把后端报错软化成用户能看懂、且不泄漏实现细节的说法。
 *
 * 运行环境的后端错误几乎都会带 docker / container / 沙箱宿主机目录前缀，
 * 直接透给用户等于把内部架构摆到台面上。文件类操作用共享的 friendlyOpenError，
 * 其余场景走这里 —— 文案不同是因为「打不开文件」和「环境起不来」不是一回事。
 */
function publicError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const low = raw.toLowerCase();
  if (!raw.trim()) return fallback;
  if (low.includes("docker") || low.includes("container") || low.includes("sandbox")) {
    return "运行环境暂时不可用，请稍后再试或联系管理员";
  }
  // 带斜杠的几乎都是路径，一并兜住
  if (/[/\\]/.test(raw) || raw.length > 120) return fallback;
  return raw;
}

/** 同上，但作用于 sandbox.last_error 这段已经存下来的历史错误文本。 */
function publicLastError(raw?: string | null): string {
  if (!raw) return "";
  return publicError(raw, "运行环境曾启动失败，请重试或联系管理员");
}

/** 内部 /workspace 路径 → 用户看到的相对路径。根目录返回空串（界面显示「我的文件」）。 */
function toPublicPath(internalPath: string): string {
  const p = normalizeWorkspacePath(internalPath);
  if (p === "/workspace") return "";
  return p.replace(/^\/workspace\/?/, "");
}

function joinPath(base: string, name: string): string {
  return [base, name].filter(Boolean).join("/");
}

export default function SandboxScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [msg, setMsg] = useState("");
  /**
   * 「跑一条命令 / 读一个文件 / 写一个文件」期间的忙碌态。
   * 它们不是缓存里的任何一把键（结果只回显在当前面板里），所以留在本地 state；
   * 但按钮的禁用口径要和原来一样是「整页一起禁」，所以并进下面的 busy。
   */
  const [fileBusy, setFileBusy] = useState(false);

  const [cmd, setCmd] = useState("echo hi");
  const [execOut, setExecOut] = useState("");

  /** 目录浏览器的路径，始终是「我的文件」下的相对路径，空串代表根目录 */
  const [dirInput, setDirInput] = useState("");
  const [entries, setEntries] = useState<SandboxDirEntry[]>([]);
  /** 应用内桌面预览；open=false 时不渲染 WebView */
  const [desktop, setDesktop] = useState<{ open: boolean; url: string }>({
    open: false,
    url: "",
  });
  const [listing, setListing] = useState(false);

  const [fileInput, setFileInput] = useState("hello.txt");
  const [fileContent, setFileContent] = useState("hello from open-bot");
  /** 实际读/写过的文件（内部路径），用于展示文件名标题 */
  const [openedFile, setOpenedFile] = useState<string>("");

  // 运行环境状态是服务端状态；这几个接口都把最新的 Sandbox 原样返回，
  // 所以成功回调里直接写缓存即可，不用再回打一次 GET。
  const sandboxQuery = useSandbox();
  const {
    ensure: ensureMut,
    stop: stopMut,
    checkpoint: checkpointMut,
    reset: resetMut,
  } = useSandboxMutations();
  const sandbox = sandboxQuery.data ?? null;
  const busy = useBusy(ensureMut, stopMut, checkpointMut, resetMut) || fileBusy;

  const refresh = () => {
    void sandboxQuery.refetch();
  };

  async function ensure(): Promise<void> {
    setMsg("");
    try {
      // ensureSandbox() 与 GET /v1/sandbox?ensure=1 是同一件事：
      // 幂等——已在运行就直接返回现状，不会重启。语义上等于「确保它开着」。
      const s = await ensureMut.mutateAsync();
      setMsg(s.status === "running" ? "运行环境已在运行" : "运行环境状态：" + statusText(s.status));
    } catch (err) {
      setMsg(publicError(err, "启动运行环境失败"));
    }
  }

  async function openDesktop(): Promise<void> {
    setMsg("");
    try {
      const s = await ensureMut.mutateAsync({ desktop: true });
      if (!s.desktop_port) {
        setMsg(
          publicLastError(s.last_error) || "桌面预览未就绪，请联系管理员确认桌面环境是否已安装"
        );
        return;
      }
      // 桌面走 API 反代 + JWT，不暴露真实端口。
      // 本轮引入了 WebView，桌面直接在应用内打开；系统浏览器作为兜底保留
      // （noVNC 在应用外启动时能复用宿主机已装好的客户端）。
      const url = await api.sandboxDesktopURL({ desktop_token: s.desktop_token });
      setDesktop({ open: true, url });
    } catch (err) {
      setMsg(publicError(err, "无法打开桌面"));
    }
  }

  async function checkpoint(): Promise<void> {
    setMsg("");
    try {
      const res = await checkpointMut.mutateAsync();
      // checkpoint_path 是宿主机目录，绝不能整段显示，只取最后一段名字
      const name = previewTitleFromPath(res.checkpoint_path || "");
      setMsg(name ? `已保存快照：${name}` : "已保存快照");
    } catch (err) {
      setMsg(publicError(err, "保存快照失败"));
    }
  }

  async function stop(): Promise<void> {
    const ok = await confirm({
      title: "停止运行环境？",
      message: "正在执行的任务会中断，助手需要重新启动环境才能继续工作。文件会保留。",
      confirmLabel: "停止",
      cancelLabel: "继续运行",
    });
    if (!ok) return;

    setMsg("");
    try {
      await stopMut.mutateAsync();
      setMsg("已停止");
    } catch (err) {
      setMsg(publicError(err, "停止运行环境失败"));
    }
  }

  async function reset(): Promise<void> {
    const ok = await confirm({
      title: "重置运行环境？",
      message:
        "运行环境里的全部文件都会被清空并重建：助手生成的脚本、产物，以及你放进去的任何内容都会消失，当前正在执行的任务会中断。系统会先自动留一份快照，但不会自动帮你恢复。",
      confirmLabel: "清空并重置",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setMsg("");
    try {
      await resetMut.mutateAsync();
      // 后端 warning 是英文内部文案（含 workspace / container 等实现细节），
      // 这里只保留它的语义：已清空，但快照还在。
      setMsg("已重置：运行文件已全部清空并重建运行环境（系统保留了一份快照）");
      setEntries([]);
      setExecOut("");
      setOpenedFile("");
    } catch (err) {
      setMsg(publicError(err, "重置运行环境失败"));
    }
  }

  async function runCommand(): Promise<void> {
    const command = cmd.trim();
    if (!command) {
      setMsg("请填写要执行的命令");
      return;
    }
    setFileBusy(true);
    setMsg("");
    setExecOut("");
    try {
      const res = await api.execSandbox({ cmd: command });
      setExecOut(
        `exit=${res.exit_code}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
      );
    } catch (err) {
      setMsg(publicError(err, "执行命令失败"));
    } finally {
      setFileBusy(false);
    }
  }

  async function listDir(path: string): Promise<void> {
    setListing(true);
    setMsg("");
    try {
      const res = await api.listSandbox(normalizeWorkspacePath(path));
      setDirInput(toPublicPath(res.path));
      setEntries(res.entries ?? []);
    } catch (err) {
      setEntries([]);
      setMsg(friendlyOpenError(err));
    } finally {
      setListing(false);
    }
  }

  async function openFile(path: string): Promise<void> {
    setFileBusy(true);
    setMsg("");
    try {
      const res = await api.readSandboxFile(normalizeWorkspacePath(path));
      setFileInput(toPublicPath(res.path));
      setFileContent(res.content);
      setOpenedFile(res.path);
      setMsg(`已读取 ${previewTitleFromPath(res.path)}`);
    } catch (err) {
      setMsg(friendlyOpenError(err));
    } finally {
      setFileBusy(false);
    }
  }

  async function saveFile(): Promise<void> {
    const path = fileInput.trim();
    if (!path) {
      setMsg("请填写文件路径");
      return;
    }
    setFileBusy(true);
    setMsg("");
    try {
      const res = await api.writeSandboxFile(normalizeWorkspacePath(path), fileContent);
      setFileInput(toPublicPath(res.path));
      setOpenedFile(res.path);
      setMsg(`已写入 ${previewTitleFromPath(res.path)}`);
    } catch (err) {
      setMsg(friendlyOpenError(err));
    } finally {
      setFileBusy(false);
    }
  }

  const segments = dirInput.split("/").filter(Boolean);

  return (
    <ScreenScaffold
      title="运行环境"
      subtitle="助手生成脚本、临时文件与预览时使用的隔离环境"
      loading={sandboxQuery.isLoading}
      error={sandboxQuery.error ? publicError(sandboxQuery.error, "读取运行环境状态失败") : null}
      onRetry={refresh}
      headerRight={
        <Button size="sm" variant="secondary" onPress={refresh}>
          <Button.Label>刷新</Button.Label>
        </Button>
      }
    >
      <Typography.Paragraph color="muted">
        一般情况下你不需要来这里——在聊天里看预览或下载结果即可。
        「我的文件」是助手和你共用的工作目录，这里可以浏览、读写和执行命令。
      </Typography.Paragraph>

      <View className="gap-3">
        <SectionTitle>状态</SectionTitle>
        <Card>
          <Card.Body className="gap-3">
            <View className="flex-row items-center gap-2">
              <Typography.Paragraph weight="medium" className="flex-1">
                {statusText(sandbox?.status)}
              </Typography.Paragraph>
              <Chip size="sm" variant="soft" color={statusChipColor(sandbox?.status)}>
                <Chip.Label>{statusText(sandbox?.status)}</Chip.Label>
              </Chip>
            </View>

            {sandbox?.created_at ? (
              <Typography.Paragraph type="body-sm" color="muted">
                创建于 {formatDateTime(sandbox.created_at)}
                {sandbox.updated_at ? ` · 最近活动 ${formatDateTime(sandbox.updated_at)}` : ""}
              </Typography.Paragraph>
            ) : null}

            {sandbox?.last_error ? (
              <Typography.Paragraph className="text-danger">
                {publicLastError(sandbox.last_error)}
              </Typography.Paragraph>
            ) : null}

            <View className="flex-row flex-wrap gap-2">
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void ensure()}>
                <Button.Label>确保启动</Button.Label>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onPress={() => void openDesktop()}
              >
                <Button.Label>打开桌面</Button.Label>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onPress={() => void checkpoint()}
              >
                <Button.Label>保存快照</Button.Label>
              </Button>
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void stop()}>
                <Button.Label>停止</Button.Label>
              </Button>
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={busy}
                onPress={() => void reset()}
              >
                <Button.Label>重置</Button.Label>
              </Button>
              <Button size="sm" variant="ghost" onPress={refresh}>
                <Button.Label>刷新</Button.Label>
              </Button>
            </View>

            <Typography.Paragraph type="body-xs" color="muted">
              桌面预览需要系统浏览器承载，会新开一个标签页；回到本应用后请手动切回来。
            </Typography.Paragraph>
          </Card.Body>
        </Card>
      </View>

      <View className="gap-3">
        <SectionTitle>执行命令</SectionTitle>
        <FormField
          label="命令"
          value={cmd}
          onChangeText={setCmd}
          placeholder="echo hi"
          hint="在运行环境中执行一条命令"
        />
        <Button
          size="sm"
          className="self-start"
          isDisabled={busy}
          onPress={() => void runCommand()}
        >
          <Button.Label>运行</Button.Label>
        </Button>
        {execOut ? (
          <View className="rounded-xl bg-background-secondary p-3">
            <Typography type="code" className="text-body-xs">
              {execOut}
            </Typography>
          </View>
        ) : null}
      </View>

      <View className="gap-3">
        <SectionTitle>我的文件</SectionTitle>

        <FormField
          label="位置"
          value={dirInput}
          onChangeText={setDirInput}
          placeholder="留空表示根目录"
          hint="填写相对路径，例如 shared 报告"
          editable={!listing}
        />

        <View className="flex-row flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={listing}
            onPress={() => void listDir(dirInput)}
          >
            <Button.Label>{listing ? "列出中…" : "列出"}</Button.Label>
          </Button>
          {segments.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                const parent = segments.slice(0, -1).join("/");
                setDirInput(parent);
                void listDir(parent);
              }}
            >
              <Button.Label>上一层</Button.Label>
            </Button>
          ) : null}
        </View>

        {segments.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-1">
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDirInput("");
                void listDir("");
              }}
            >
              <Typography.Paragraph type="body-sm" className="text-accent">
                我的文件
              </Typography.Paragraph>
            </Pressable>
            {segments.map((seg, i) => (
              <View key={`${seg}-${i}`} className="flex-row items-center gap-1">
                <Typography.Paragraph type="body-sm" color="muted">
                  /
                </Typography.Paragraph>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const next = segments.slice(0, i + 1).join("/");
                    setDirInput(next);
                    void listDir(next);
                  }}
                >
                  {/* 最后一段是当前位置，用默认色；其余是可点的上级路径，用 accent 提示可点击 */}
                  <Typography.Paragraph
                    type="body-sm"
                    className={i === segments.length - 1 ? undefined : "text-accent"}
                  >
                    {seg}
                  </Typography.Paragraph>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {entries.length > 0 ? (
          <ListGroup>
            {entries.map((e) => (
              <ListGroup.Item key={`${e.is_dir ? "d" : "f"}-${e.name}`}>
                <Pressable
                  className="flex-1"
                  accessibilityRole="button"
                  onPress={() => {
                    const next = joinPath(dirInput, e.name);
                    if (e.is_dir) {
                      setDirInput(next);
                      void listDir(next);
                    } else {
                      setFileInput(next);
                      void openFile(next);
                    }
                  }}
                >
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>
                      {e.is_dir ? `${e.name}（目录）` : e.name}
                    </ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {e.is_dir ? "点击进入" : formatSize(e.size)}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                </Pressable>
                {/* ItemSuffix 不传 children 时自带 chevron-right 图标 */}
                <ListGroup.ItemSuffix />
              </ListGroup.Item>
            ))}
          </ListGroup>
        ) : null}

        {openedFile ? (
          <Typography.Paragraph type="body-sm" color="muted">
            当前文件：{previewTitleFromPath(openedFile)}
          </Typography.Paragraph>
        ) : null}

        <FormField
          label="文件路径"
          value={fileInput}
          onChangeText={setFileInput}
          placeholder="hello.txt"
          hint="相对「我的文件」的路径，例如 shared/报告.md"
        />
        <FormField label="内容" multiline value={fileContent} onChangeText={setFileContent} />

        <View className="flex-row gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            isDisabled={busy}
            onPress={() => void saveFile()}
          >
            <Button.Label>写入</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            isDisabled={busy}
            onPress={() => void openFile(fileInput)}
          >
            <Button.Label>读取</Button.Label>
          </Button>
        </View>
      </View>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}

      {desktop.open && desktop.url ? (
        <WebPreviewModal
          visible
          onClose={() => setDesktop({ open: false, url: "" })}
          mode="url"
          uri={desktop.url}
          title="运行环境桌面"
        />
      ) : null}
    </ScreenScaffold>
  );
}
