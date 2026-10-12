import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { fileURLToPath, URL } from "node:url";

// Shared by Web browser and Tauri desktop (apps/desktop points here).
export default defineConfig(({ command }) => ({
  appType: "spa",
  plugins: [
    // Dev-only: Option+Shift (macOS) / Alt+Shift hover to jump to source.
    command === "serve" &&
      codeInspectorPlugin({
        bundler: "vite",
      }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/codemirror")) {
            return "codemirror";
          }
          if (id.includes("/components/SkillEditor") || id.includes("/components/CodeEditor")) {
            return "skill-editor";
          }
          if (id.includes("/components/BotSettingsPanel")) {
            return "settings-bot";
          }
        },
      },
    },
  },
  // Avoid clearing Rust/Tauri compile output when tauri runs beforeDevCommand.
  clearScreen: false,
  server: {
    port: 5173,
    host: "127.0.0.1",
    // Tauri expects a fixed port matching tauri.conf.json devUrl.
    strictPort: true,
  },
}));
