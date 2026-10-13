#!/usr/bin/env node
/**
 * 开发启动包装：探测本机局域网 IPv4，注入 EXPO_PUBLIC_OPENBOT_API_BASE，
 * 再执行后续命令（expo start / run:ios / run:android）。
 *
 * 真机访问不到 127.0.0.1 / 10.0.2.2；用电脑 LAN IP 模拟器与真机都能打到 API。
 *
 * 优先级：
 * 1. 已在 shell 里设置的 EXPO_PUBLIC_OPENBOT_API_BASE
 * 2. apps/mobile-rn/.env 里非环回 / 非模拟器地址（如 ngrok）
 * 3. 自动探测的局域网 IP
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_PORT = process.env.OPENBOT_API_PORT?.trim() || "18080";
const PREFERRED_IFACES = ["en0", "en1", "eth0", "wlan0", "Wi-Fi", "Ethernet", "无线网络连接"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isIPv4(addr) {
  return addr.family === "IPv4" || addr.family === 4;
}

function isUsableLan(addr) {
  if (!isIPv4(addr) || addr.internal) return false;
  // 链路本地不当作手机可达的宿主机地址
  return !addr.address.startsWith("169.254.");
}

function detectLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of PREFERRED_IFACES) {
    for (const addr of nets[name] || []) {
      if (isUsableLan(addr)) return addr.address;
    }
  }
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (isUsableLan(addr)) return addr.address;
    }
  }
  return null;
}

/** 环回 / Android 模拟器别名 → 真机连不上，需要换成 LAN IP */
function isDeviceUnreachableBase(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "10.0.2.2"
    );
  } catch {
    return false;
  }
}

function readDotEnvApiBase() {
  const envPath = path.join(ROOT, ".env");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^EXPO_PUBLIC_OPENBOT_API_BASE\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v.trim() || null;
  }
  return null;
}

function ensureApiBase() {
  const fromShell = process.env.EXPO_PUBLIC_OPENBOT_API_BASE?.trim();
  if (fromShell && !isDeviceUnreachableBase(fromShell)) {
    console.log(`[mobile-rn] API base (shell): ${fromShell}`);
    return fromShell;
  }

  const fromFile = readDotEnvApiBase();
  if (fromFile && !isDeviceUnreachableBase(fromFile)) {
    process.env.EXPO_PUBLIC_OPENBOT_API_BASE = fromFile;
    console.log(`[mobile-rn] API base (.env): ${fromFile}`);
    return fromFile;
  }
  if (fromFile && isDeviceUnreachableBase(fromFile)) {
    console.warn(
      `[mobile-rn] .env 里的 ${fromFile} 真机连不上，已忽略；改用局域网 IP（或删掉该行）`,
    );
  }
  if (fromShell && isDeviceUnreachableBase(fromShell)) {
    console.warn(
      `[mobile-rn] shell 里的 ${fromShell} 真机连不上，已忽略；改用局域网 IP`,
    );
  }

  const ip = detectLanIPv4();
  if (!ip) {
    console.warn(
      "[mobile-rn] 未检测到局域网 IP，沿用应用内平台默认（模拟器可用；真机请设置 EXPO_PUBLIC_OPENBOT_API_BASE）",
    );
    return null;
  }
  const base = `http://${ip}:${API_PORT}`;
  process.env.EXPO_PUBLIC_OPENBOT_API_BASE = base;
  console.log(`[mobile-rn] API base (LAN): ${base}`);
  return base;
}

ensureApiBase();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法: node scripts/with-lan-api.mjs <command> [args...]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
