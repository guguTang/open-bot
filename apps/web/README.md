# apps/web

Vite + React + TypeScript 聊天 UI（浏览器、Tauri、Capacitor 壳共用）。

```bash
pnpm install
pnpm --dir apps/web dev
```

默认请求 `http://127.0.0.1:18080`，可用 `VITE_API_BASE` 覆盖。

## UI

- Tailwind CSS v4（`@tailwindcss/vite`）+ `src/styles.css`
- shadcn/ui new-york（Radix）：`components.json`、`src/components/ui/`、`src/lib/utils.ts`（`cn`）
- 颜色：Uber oklch 令牌在 `src/styles/uber-theme.css`，经 `@theme` 映射到 shadcn 变量；暗色由 `src/lib/theme.ts` 写到 `html.dark`
- 侧栏是自定义壳（`sidebarUi.ts`），不用 shadcn `Sidebar.Provider`（会和 Tauri/Capacitor 窄布局冲突）
- 确认框：`ConfirmProvider` / `useConfirm()`（AlertDialog；窄屏仍是自定义 action sheet）
- Toast：sonner（根节点 `<Toaster />`，调用 `@/lib/toast`）
- 路径别名：`@/` → `src/`
