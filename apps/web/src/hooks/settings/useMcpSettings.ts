import { FormEvent, useCallback, useState } from "react";
import {
  createMCPServer,
  deleteMCPServer,
  listMCPServers,
  mcpCallTool,
  MCPServer,
  MCPServerInput,
  testMCPServer,
  updateMCPServer,
} from "../../api";

type ConfirmFn = (opts: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}) => Promise<boolean>;

export function useMcpSettings(confirm: ConfirmFn) {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpMsg, setMcpMsg] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpForm, setMcpForm] = useState<MCPServerInput>({
    name: "echo",
    transport: "stdio",
    command: "",
    args: [],
    url: "",
    enabled: true,
  });
  const [mcpArgsText, setMcpArgsText] = useState("[]");
  const [mcpTestResult, setMcpTestResult] = useState("");
  const [mcpCallServerId, setMcpCallServerId] = useState("");
  const [mcpCallToolName, setMcpCallToolName] = useState("echo");
  const [mcpCallArgs, setMcpCallArgs] = useState('{"message":"hello"}');
  const [mcpCallResult, setMcpCallResult] = useState("");

  const refreshMCP = useCallback(async () => {
    const list = await listMCPServers();
    setMcpServers(list);
  }, []);

  const saveMCP = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setMcpBusy(true);
      setMcpMsg("");
      try {
        let args: string[] = [];
        try {
          const parsed = JSON.parse(mcpArgsText || "[]");
          if (!Array.isArray(parsed)) throw new Error("args 须为 JSON 数组");
          args = parsed.map(String);
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : "args JSON 无效");
        }
        const body: MCPServerInput = {
          name: mcpForm.name,
          transport: mcpForm.transport,
          command: mcpForm.command || "",
          args,
          url: mcpForm.url || "",
          enabled: mcpForm.enabled !== false,
        };
        await createMCPServer(body);
        setMcpMsg("已创建");
        setMcpForm({
          name: "",
          transport: "stdio",
          command: "",
          args: [],
          url: "",
          enabled: true,
        });
        setMcpArgsText("[]");
        await refreshMCP();
      } catch (err) {
        setMcpMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setMcpBusy(false);
      }
    },
    [mcpArgsText, mcpForm, refreshMCP],
  );

  const toggleMCP = useCallback(
    async (s: MCPServer, enabled: boolean) => {
      setMcpBusy(true);
      setMcpMsg("");
      try {
        await updateMCPServer(s.id, { enabled });
        await refreshMCP();
      } catch (err) {
        setMcpMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setMcpBusy(false);
      }
    },
    [refreshMCP],
  );

  const removeMCP = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "删除该 MCP server？",
        confirmLabel: "删除",
        cancelLabel: "取消",
        danger: true,
      });
      if (!ok) return;
      setMcpBusy(true);
      setMcpMsg("");
      try {
        await deleteMCPServer(id);
        await refreshMCP();
      } catch (err) {
        setMcpMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setMcpBusy(false);
      }
    },
    [confirm, refreshMCP],
  );

  const runTestMCP = useCallback(async (id: string) => {
    setMcpBusy(true);
    setMcpTestResult("");
    setMcpMsg("");
    try {
      const r = await testMCPServer(id);
      if (r.ok) {
        const names = r.tool_names || (r.tools || []).map((t) => t.name);
        setMcpTestResult(`连接成功 · 工具: ${names.join(", ") || "(无)"}`);
      } else {
        setMcpTestResult(`失败: ${r.error || "unknown"}`);
      }
    } catch (err) {
      setMcpTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  }, []);

  const runCallMCP = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setMcpBusy(true);
    setMcpCallResult("");
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(mcpCallArgs || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("arguments 须为 JSON 对象");
      }
      if (!mcpCallServerId) throw new Error("请选择 server");
      const r = await mcpCallTool({
        server_id: mcpCallServerId,
        tool: mcpCallToolName,
        arguments: args,
      });
      setMcpCallResult(
        r.error ? `错误: ${r.error}` : r.text || JSON.stringify(r, null, 2),
      );
    } catch (err) {
      setMcpCallResult(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  }, [mcpCallArgs, mcpCallServerId, mcpCallToolName]);

  const fillEchoExample = useCallback(() => {
    setMcpForm({
      name: "echo",
      transport: "stdio",
      command:
        "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/.venv/bin/python",
      args: [
        "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/examples/mcp_echo_server.py",
      ],
      url: "",
      enabled: true,
    });
    setMcpArgsText(
      JSON.stringify([
        "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/examples/mcp_echo_server.py",
      ]),
    );
    setMcpMsg("已填入本地 echo 示例路径");
  }, []);

  return {
    mcpServers,
    mcpMsg,
    setMcpMsg,
    mcpBusy,
    mcpForm,
    setMcpForm,
    mcpArgsText,
    setMcpArgsText,
    mcpTestResult,
    setMcpTestResult,
    mcpCallServerId,
    setMcpCallServerId,
    mcpCallToolName,
    setMcpCallToolName,
    mcpCallArgs,
    setMcpCallArgs,
    mcpCallResult,
    refreshMCP,
    saveMCP,
    toggleMCP,
    removeMCP,
    runTestMCP,
    runCallMCP,
    fillEchoExample,
  };
}
