import type { FormEvent } from "react";
import type { MCPServer, MCPServerInput } from "../../api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void onTestMcp(s.id)} disabled={mcpBusy}>
                      测试连接
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onToggleMcp(s, !s.enabled)}
                      disabled={mcpBusy}
                    >
                      {s.enabled ? "停用" : "启用"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void onRemoveMcp(s.id)}
                      disabled={mcpBusy}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {mcpTestResult ? <p className="settings-status m-0">{mcpTestResult}</p> : null}
        {mcpMsg ? <p className="settings-status m-0">{mcpMsg}</p> : null}
      </SettingsSection>
      <SettingsSection title="新增 MCP server">
        <SettingsCard padded>
          <form onSubmit={onSaveMcp}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mcp-name">名称</FieldLabel>
                <Input
                  id="mcp-name"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-transport">传输</FieldLabel>
                <NativeSelect
                  id="mcp-transport"
                  value={mcpForm.transport}
                  onChange={(e) =>
                    setMcpForm({
                      ...mcpForm,
                      transport: e.target.value as MCPServerInput["transport"],
                    })
                  }
                >
                  <NativeSelectOption value="stdio">stdio</NativeSelectOption>
                  <NativeSelectOption value="sse">sse</NativeSelectOption>
                  <NativeSelectOption value="http">http</NativeSelectOption>
                </NativeSelect>
              </Field>
              {mcpForm.transport === "stdio" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="mcp-command">
                      command（绝对路径或 python3/node/npx/uv…）
                    </FieldLabel>
                    <Input
                      id="mcp-command"
                      value={mcpForm.command || ""}
                      onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                      placeholder="python3"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-args">args（JSON 数组）</FieldLabel>
                    <Input
                      id="mcp-args"
                      value={mcpArgsText}
                      onChange={(e) => setMcpArgsText(e.target.value)}
                      placeholder='["/path/to/server.py"]'
                    />
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
                  <Input
                    id="mcp-url"
                    value={mcpForm.url || ""}
                    onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                    placeholder="http://127.0.0.1:8000/sse"
                    required
                  />
                </Field>
              )}
              <Field orientation="horizontal">
                <Checkbox
                  id="mcp-enabled"
                  checked={mcpForm.enabled !== false}
                  onCheckedChange={(checked) =>
                    setMcpForm({ ...mcpForm, enabled: checked === true })
                  }
                />
                <FieldLabel htmlFor="mcp-enabled" className="font-normal">
                  启用
                </FieldLabel>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={mcpBusy}>
                  {mcpBusy ? "保存中…" : "新增"}
                </Button>
                <Button type="button" variant="outline" onClick={onFillEchoExample}>
                  填入 echo 示例
                </Button>
              </div>
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="手动调用工具">
        <SettingsCard padded>
          <form onSubmit={onRunCallMcp}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mcp-call-server">Server</FieldLabel>
                <NativeSelect
                  id="mcp-call-server"
                  value={mcpCallServerId}
                  onChange={(e) => setMcpCallServerId(e.target.value)}
                >
                  <NativeSelectOption value="">选择…</NativeSelectOption>
                  {mcpServers.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-call-tool">Tool 名</FieldLabel>
                <Input
                  id="mcp-call-tool"
                  value={mcpCallToolName}
                  onChange={(e) => setMcpCallToolName(e.target.value)}
                  placeholder="echo"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-call-args">Arguments（JSON）</FieldLabel>
                <Textarea
                  id="mcp-call-args"
                  rows={3}
                  value={mcpCallArgs}
                  onChange={(e) => setMcpCallArgs(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={mcpBusy}>
                  调用
                </Button>
              </div>
              {mcpCallResult ? (
                <pre className="settings-status m-0">{mcpCallResult}</pre>
              ) : null}
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
