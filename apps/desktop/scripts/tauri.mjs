#!/usr/bin/env node
/**
 * `pnpm tauri …` entry. macOS `build` signs the .app through Tauri, then writes
 * the installer DMG without Finder AppleScript.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePaths, readDesktopConfig, rewriteBuildArgs } from "./lib/bundle-plan.mjs";
import { createInstallerDmg, removeStaleRwImages } from "./macos-dmg.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const { argv, makeDmg } = rewriteBuildArgs(args);

const bin = resolveTauriBin(desktopRoot);
const result = spawnSync(bin, argv, { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

if (!makeDmg) process.exit(0);

const conf = readDesktopConfig(
  JSON.parse(readFileSync(path.join(desktopRoot, "src-tauri", "tauri.conf.json"), "utf8")),
);
const paths = bundlePaths({
  tauriDir: path.join(desktopRoot, "src-tauri"),
  productName: conf.productName,
  version: conf.version,
  argv: args,
  hostArch: process.arch,
});
removeStaleRwImages(paths.appDir);
removeStaleRwImages(paths.dmgDir);
mkdirSync(paths.dmgDir, { recursive: true });
const output = await createInstallerDmg({
  appPath: paths.appPath,
  outputPath: paths.dmgPath,
  staleDirs: [paths.appDir, paths.dmgDir],
  volumeIcon: path.join(desktopRoot, "src-tauri", "icons", "icon.icns"),
  signingIdentity: conf.signingIdentity,
  spec: {
    volumeName: conf.productName,
    appFileName: `${conf.productName}.app`,
    windowSize: conf.windowSize,
    windowPosition: conf.windowPosition,
    appPosition: conf.appPosition,
    applicationsPosition: conf.applicationFolderPosition,
    iconSize: 128,
  },
});
console.log(`DMG: ${output}`);

function resolveTauriBin(root) {
  const name = process.platform === "win32" ? "tauri.cmd" : "tauri";
  const candidates = [
    path.join(root, "node_modules", ".bin", name),
    path.join(root, "..", "..", "node_modules", ".bin", name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return name;
}
