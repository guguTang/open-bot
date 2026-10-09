import { Button, Card, Chip, RadioGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { MCPServer, MCPServerInput } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";

/**
 * MCP Client server 管理。行为对齐 `apps/web/src/App.tsx` 的 `settingsTab === "mcp"` 分区。
 *
 * 三条容易踩的规则都在这里保留：
 * 1. transport 分支决定必填项 —— stdio 要 command，sse/http 要 url，反之留空也不拦。
 * 2. `args` 在表单里是 JSON 文本，提交前必须解析成字符串数组，解析失败整单不提交。
 * 3. 测试连接的结果有多种形状（`tool_names` / `tools` / `count` / `error`），
 *    老服务端只回其中一部分，展示层要做兜底而不是直接读某个字段。
 */

const TRANSPORTS = ["stdio", "sse", "http"] as const;

const emptyForm: MCPServerInput = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  url: "",
  enabled: true,
};

type FieldErrors = {
  name?: string;
  command?: string;
  url?: string;
};

export default function McpSettingsScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [testResult, setTestResult] = useState("");

  const [form, setForm] = useState<MCPServerInput>(emptyForm);
  const [argsText, setArgsText] = useState("[]");
  const [errors, setErrors] = useState<FieldErrors>({});

  // 手动调用工具
  const [callBusy, setCallBusy] = useState(false);
  const [callServerId, setCallServerId] = useState("");
  const [callToolName, setCallToolName] = useState("echo");
  const [callArgs, setCallArgs] = useState('{"message":"hello"}');
  const [callResult, setCallResult] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setServers(await api.listMCPServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function patch(next: Partial<MCPServerInput>): void {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function createServer(): Promise<void> {
    const name = form.name.trim();
    const nextErrors: FieldErrors = {};
    if (!name) nextErrors.name = "名称必填";
    // transport 决定必填项 —— stdio 走本地进程要 command，sse/http 走网络要 url。
    if (form.transport === "stdio") {
      if (!form.command?.trim()) nextErrors.command = "command 必填";
    } else if (!form.url?.trim()) {
      nextErrors.url = "URL 必填";
    }
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.command || nextErrors.url) return;

    setBusy(true);
    setMsg("");
    try {
      let args: string[] = [];
      try {
        const parsed: unknown = JSON.parse(argsText || "[]");
        if (!Array.isArray(parsed)) throw new Error("args 须为 JSON 数组");
        args = parsed.map(String);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "args JSON 无效");
      }

      await api.createMCPServer({
        name,
        transport: form.transport,
        // command / url 都照原样提交，由后端按 transport 取用 —— 与 Web 端一致。
        command: form.command || "",
        args,
        url: form.url || "",
        enabled: form.enabled !== false,
      });
      setMsg("已创建");
      setForm(emptyForm);
      setArgsText("[]");
      setErrors({});
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: MCPServer, enabled: boolean): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      await api.updateMCPServer(s.id, { enabled });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: MCPServer): Promise<void> {
    const ok = await confirm({
      title: "删除该 MCP server？",
      message: "助手将立即失去该 server 提供的工具。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api.deleteMCPServer(s.id);
      // 手动调用面板正选中它的话要同步清掉，否则下一次调用会指向已删除的 server。
      if (callServerId === s.id) setCallServerId("");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest(s: MCPServer): Promise<void> {
    setBusy(true);
    setTestResult("");
    setMsg("");
    try {
      const r = await api.testMCPServer(s.id);
      if (r.ok) {
        // 新服务端回 tool_names，旧服务端只回 tools，这里两边都兜住。
        const names = r.tool_names || (r.tools || []).map((t) => t.name);
        const count = typeof r.count === "number" ? r.count : names.length;
        setTestResult(`连接成功 · 工具（${count}）: ${names.join(", ") || "(无)"}`);
      } else {
        setTestResult(`失败: ${r.error || "unknown"}`);
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function callTool(): Promise<void> {
    setCallBusy(true);
    setCallResult("");
    try {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(callArgs || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("arguments 须为 JSON 对象");
      }
      if (!callServerId) throw new Error("请选择 server");
      const r = await api.mcpCallTool({
        server_id: callServerId,
        tool: callToolName,
        arguments: args,
      });
      setCallResult(r.error ? `错误: ${r.error}` : r.text || JSON.stringify(r, null, 2));
    } catch (err) {
      setCallResult(err instanceof Error ? err.message : String(err));
    } finally {
      setCallBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="MCP"
      subtitle="外部工具服务"
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      <Typography.Paragraph color="muted">
        配置 MCP Client servers（stdio / sse / http）。启用后，在 LLM 开启 tools 时会注入工具；本地
        vLLM 无 function-calling 时可用下方手动「调用工具」。
      </Typography.Paragraph>

      {testResult ? (
        <Card className="border-accent">
          <Card.Body>
            <Typography.Paragraph>{testResult}</Typography.Paragraph>
          </Card.Body>
        </Card>
      ) : null}
      {msg ? (
        <Card>
          <Card.Body>
            <Typography.Paragraph color="muted">{msg}</Typography.Paragraph>
          </Card.Body>
        </Card>
      ) : null}

      {servers.length === 0 ? (
        <Typography.Paragraph color="muted">暂无 MCP server，请在下方新增。</Typography.Paragraph>
      ) : (
        servers.map((s) => (
          <Card key={s.id}>
            <Card.Body className="gap-2">
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Typography.Heading type="h4" numberOfLines={1}>
                    {s.name}
                  </Typography.Heading>
                </View>
                <Chip size="sm" variant="soft" color={s.enabled ? "success" : "default"}>
                  {s.enabled ? "启用" : "停用"}
                </Chip>
              </View>

              <Typography.Paragraph color="muted">
                {s.transport}
                {s.transport === "stdio"
                  ? ` · ${s.command} ${(s.args || []).join(" ")}`
                  : ` · ${s.url}`}
              </Typography.Paragraph>

              <View className="mt-1 flex-row flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void runTest(s)}
                >
                  <Button.Label>测试连接</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy}
                  onPress={() => void toggle(s, !s.enabled)}
                >
                  <Button.Label>{s.enabled ? "停用" : "启用"}</Button.Label>
                </Button>
                <Button size="sm" variant="danger" isDisabled={busy} onPress={() => void remove(s)}>
                  <Button.Label>删除</Button.Label>
                </Button>
              </View>
            </Card.Body>
          </Card>
        ))
      )}

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>新增 MCP server</SectionTitle>

          <FormField
            label="名称"
            value={form.name}
            onChangeText={(t) => patch({ name: t })}
            placeholder="echo"
            error={errors.name}
            required
          />

          <View className="gap-2">
            <Typography.Paragraph color="muted">传输</Typography.Paragraph>
            <RadioGroup
              value={form.transport}
              onValueChange={(v) => patch({ transport: v })}
              className="flex-row flex-wrap gap-4"
            >
              {TRANSPORTS.map((t) => (
                <RadioGroup.Item key={t} value={t}>
                  {t}
                </RadioGroup.Item>
              ))}
            </RadioGroup>
          </View>

          {form.transport === "stdio" ? (
            <>
              <FormField
                label="command（绝对路径或 python3/node/npx/uv…）"
                value={form.command ?? ""}
                onChangeText={(t) => patch({ command: t })}
                placeholder="/path/to/.venv/bin/python"
                error={errors.command}
                required
              />
              <FormField
                label="args（JSON 数组）"
                value={argsText}
                onChangeText={setArgsText}
                placeholder='["/path/to/mcp_echo_server.py"]'
              />
            </>
          ) : (
            <FormField
              label="URL"
              value={form.url ?? ""}
              onChangeText={(t) => patch({ url: t })}
              placeholder="http://127.0.0.1:8000/sse"
              error={errors.url}
              keyboardType="url"
              required
            />
          )}

          <SwitchRow
            label="启用"
            value={form.enabled !== false}
            onValueChange={(v) => patch({ enabled: v })}
          />

          <Button isDisabled={busy} onPress={() => void createServer()}>
            <Button.Label>{busy ? "保存中…" : "新增"}</Button.Label>
          </Button>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>手动调用工具</SectionTitle>

          <View className="gap-2">
            <Typography.Paragraph color="muted">Server</Typography.Paragraph>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                size="sm"
                variant={callServerId === "" ? "primary" : "secondary"}
                color={callServerId === "" ? "accent" : "default"}
                onPress={() => setCallServerId("")}
              >
                选择…
              </Chip>
              {servers.map((s) => (
                <Chip
                  key={s.id}
                  size="sm"
                  variant={callServerId === s.id ? "primary" : "secondary"}
                  color={callServerId === s.id ? "accent" : "default"}
                  onPress={() => setCallServerId(s.id)}
                >
                  {s.name}
                </Chip>
              ))}
            </View>
          </View>

          <FormField
            label="Tool 名"
            value={callToolName}
            onChangeText={setCallToolName}
            placeholder="echo"
            required
          />
          <FormField
            label="Arguments（JSON）"
            value={callArgs}
            onChangeText={setCallArgs}
            multiline
          />

          <Button isDisabled={callBusy || !callServerId} onPress={() => void callTool()}>
            <Button.Label>{callBusy ? "调用中…" : "调用"}</Button.Label>
          </Button>

          {callResult ? (
            <Typography.Paragraph className="text-xs">{callResult}</Typography.Paragraph>
          ) : null}
        </Card.Body>
      </Card>
    </ScreenScaffold>
  );
}
