/**
 * 壳层里高频、但和会话数据无关的 UI。
 * 搜索框每敲一个字都会变；订阅留在侧栏，避免整页 App 跟着输入重渲染。
 */

import { create } from "zustand";

type ShellState = {
  convSearch: string;
  setConvSearch: (value: string) => void;
  reset: () => void;
};

export const useShellStore = create<ShellState>()((set) => ({
  convSearch: "",
  setConvSearch: (convSearch) => set({ convSearch }),
  reset: () => set({ convSearch: "" }),
}));
