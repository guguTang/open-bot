import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ command }) => ({
  appType: "spa",
  plugins: [
    // Dev-only: Option+Shift (macOS) / Alt+Shift hover to jump to source.
    command === "serve" &&
      codeInspectorPlugin({
        bundler: "vite",
      }),
    react(),
  ],
  clearScreen: false,
  resolve: {
    dedupe: ["react", "react-dom", "antd", "@ant-design/icons"],
    alias: {
      // pnpm: pro-* packages import @ant-design/icons without declaring it;
      // pin to this app's direct dependency so Vite/Rollup can resolve.
      "@ant-design/icons": fileURLToPath(
        new URL("./node_modules/@ant-design/icons", import.meta.url),
      ),
    },
  },
  server: {
    port: 5174,
    host: "127.0.0.1",
    strictPort: true,
  },
}));
