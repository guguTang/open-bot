import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { fileURLToPath, URL } from "node:url";

// Shared by Web browser and Tauri desktop (apps/desktop points here).
export default defineConfig(({ command }) => ({
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "codemirror",
              test: /node_modules[\\/](@codemirror|codemirror)/,
              priority: 30,
            },
            {
              name: "skill-editor",
              test: /[\\/]components[\\/](SkillEditor|CodeEditor)/,
              priority: 25,
            },
            {
              name: "settings-bot",
              test: /[\\/]components[\\/]BotSettingsPanel/,
              priority: 25,
            },
          ],
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
  test: {
    environment: "happy-dom",
    dir: "./src",
    include: ["**/*.{test,spec}.{ts,tsx}"],
  },
}));
