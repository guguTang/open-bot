/**
 * OpenUI 组件 → 聊天宿主的桥。
 *
 * 默认实现把点击当作用户发言（走工作区 sessionActions 的 sendUserText），
 * 链接用新标签页打开。测试或只读场景（技能预览等）可用 Provider 覆盖。
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import { chatSessionActions } from "../stores/sessionActions";

export type OpenUiHost = {
  send: (text: string) => void;
  openUrl: (url: string) => void;
  /** true = 只展示，不可交互（复用 Renderer 的 isStreaming 锁）。 */
  readonly: boolean;
};

export const defaultOpenUiHost: OpenUiHost = {
  send: (text) => void chatSessionActions().sendUserText(text),
  openUrl: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  readonly: false,
};

const Ctx = createContext<OpenUiHost>(defaultOpenUiHost);

export function OpenUiHostProvider({ value, children }: { value: OpenUiHost; children: ReactNode }) {
  return createElement(Ctx.Provider, { value }, children);
}

export function useOpenUiHost(): OpenUiHost {
  return useContext(Ctx);
}
