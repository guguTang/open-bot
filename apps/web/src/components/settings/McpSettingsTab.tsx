import type { FormEvent } from "react";
import type { MCPServer, MCPServerInput } from "../../api";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type McpSettingsTabProps = {
  mcpServers: MCPServer[];
  mcpBusy: boolean;
  mcpMsg: string;
  mcpTestResult: string;
  mcpForm: MCPServerInput;
  setMcpForm: (v: MCPServerInput) => void;
  mcpArgsText: string;
  setMcpArgsText: (v: string) => void;
  mcpCallServerId: string;
  setMcpCallServerId: (v: string) => void;
  mcpCallToolName: string;
  setMcpCallToolName: (v: string) => void;
  mcpCallArgs: string;
  setMcpCallArgs: (v: string) => void;
  mcpCallResult: string;
  onSaveMcp: (e: FormEvent) => void | Promise<void>;
  onRunCallMcp: (e: FormEvent) => void | Promise<void>;
  onTestMcp: (id: string) => void | Promise<void>;
  onToggleMcp: (server: MCPServer, enabled: boolean) => void | Promise<void>;
  onRemoveMcp: (id: string) => void | Promise<void>;
  onFillEchoExample: () => void;
};

export function McpSettingsTab({
  mcpServers,
  mcpBusy,
  mcpMsg,
  mcpTestResult,
  mcpForm,
  setMcpForm,
  mcpArgsText,
  setMcpArgsText,
  mcpCallServerId,
  setMcpCallServerId,
  mcpCallToolName,
  setMcpCallToolName,
  mcpCallArgs,
  setMcpCallArgs,
  mcpCallResult,
  onSaveMcp,
  onRunCallMcp,
  onTestMcp,
  onToggleMcp,
  onRemoveMcp,
  onFillEchoExample,
}: McpSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        插件 / MCP：账号级连接（stdio / sse / http）。启用后可在作曲框用 @mcp:名称 引用；模型开启 tools 时会注入工具。上游不支持 function calling 时可用下方手动调用测试连接。
      </SettingsHint>
      <SettingsSection title="已配置">
        <SettingsCard>
          <div className="llm-list">
            {mcpServers.length === 0 ? (
              <SettingsEmpty>暂无 MCP server，请在下方新增。</SettingsEmpty>
            ) : (
              mcpServers.map((s) => (
                <div key={s.id} className="llm-item">
                  <div>
                    <div className="agent-name">
                      {s.name}
                      {s.enabled ? <span className="tag">启用</span> : <span className="tag">停用</span>}
                    </div>
                    <div className="agent-desc">
                      {s.transport}
                      {s.transport === "stdio"
                        ? ` · ${s.command} ${(s.args || []).join(" ")}`
                        : ` · ${s.url}`}
                    </div>
                  </div>
                  <div className="llm-actions">
                    <button type="button" onClick={() => void onTestMcp(s.id)} disabled={mcpBusy}>
                      测试连接
                    </button>
                    <button
                      type="button"
                      onClick={() => void onToggleMcp(s, !s.enabled)}
                      disabled={mcpBusy}
                    >
                      {s.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void onRemoveMcp(s.id)}
                      disabled={mcpBusy}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {mcpTestResult ? <div className="settings-status">{mcpTestResult}</div> : null}
        {mcpMsg ? <div className="settings-status">{mcpMsg}</div> : null}
      </SettingsSection>
      <SettingsSection title="新增 MCP server">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onSaveMcp}>
            <label>
              名称
              <input
                value={mcpForm.name}
                onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                required
              />
            </label>
            <label>
              传输
              <select
                value={mcpForm.transport}
                onChange={(e) =>
                  setMcpForm({
                    ...mcpForm,
                    transport: e.target.value as MCPServerInput["transport"],
                  })
                }
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </select>
            </label>
            {mcpForm.transport === "stdio" ? (
              <>
                <label>
                  command（绝对路径或 python3/node/npx/uv…）
                  <input
                    value={mcpForm.command || ""}
                    onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                    placeholder="python3"
                    required
                  />
                </label>
                <label>
                  args（JSON 数组）
                  <input
                    value={mcpArgsText}
                    onChange={(e) => setMcpArgsText(e.target.value)}
                    placeholder='["/path/to/server.py"]'
                  />
                </label>
              </>
            ) : (
              <label>
                URL
                <input
                  value={mcpForm.url || ""}
                  onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                  placeholder="http://127.0.0.1:8000/sse"
                  required
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={mcpForm.enabled !== false}
                onChange={(e) => setMcpForm({ ...mcpForm, enabled: e.target.checked })}
              />
              启用
            </label>
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={mcpBusy}>
                {mcpBusy ? "保存中…" : "新增"}
              </button>
              <button type="button" onClick={onFillEchoExample}>
                填入 echo 示例
              </button>
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="手动调用工具">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onRunCallMcp}>
            <label>
              Server
              <select
                value={mcpCallServerId}
                onChange={(e) => setMcpCallServerId(e.target.value)}
              >
                <option value="">选择…</option>
                {mcpServers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tool 名
              <input
                value={mcpCallToolName}
                onChange={(e) => setMcpCallToolName(e.target.value)}
                placeholder="echo"
                required
              />
            </label>
            <label>
              Arguments（JSON）
              <textarea
                rows={3}
                value={mcpCallArgs}
                onChange={(e) => setMcpCallArgs(e.target.value)}
              />
            </label>
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={mcpBusy}>
                调用
              </button>
            </div>
            {mcpCallResult ? (
              <pre className="settings-status">{mcpCallResult}</pre>
            ) : null}
          </form>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
