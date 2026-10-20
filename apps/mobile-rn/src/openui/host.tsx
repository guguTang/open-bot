/**
 * OpenUI 组件 → 聊天页的桥。聊天页（app/chats/[id].tsx）提供 send；
 * 没有 Provider 时（只读预览等）组件只展示、不可交互。
 */
import { createContext, useContext, type ReactNode } from "react";
import { Linking } from "react-native";

export type OpenUiHost = {
  send: (text: string) => void;
  openUrl: (url: string) => void;
  readonly: boolean;
};

const readonlyHost: OpenUiHost = {
  send: () => {},
  openUrl: (url) => void Linking.openURL(url),
  readonly: true,
};

const Ctx = createContext<OpenUiHost>(readonlyHost);

export function OpenUiHostProvider({
  value,
  children,
}: {
  value: OpenUiHost;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpenUiHost(): OpenUiHost {
  return useContext(Ctx);
}
