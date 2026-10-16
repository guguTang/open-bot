/**
 * Installer DMG with an app icon and an Applications shortcut.
 * Layout comes from a generated .DS_Store (same approach as appdmg), so the
 * build does not ask Finder to run AppleScript.
 */
import { spawn, spawnSync } from "node:child_process";
import { dmgSigningIdentity } from "./lib/bundle-plan.mjs";
import { createRequire } from "node:module";
import { copyFile, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const CUSTOM_ICON_FINDER_INFO =
  "0000000000000000040000000000000000000000000000000000000000000000";

export function removeStaleRwImages(dir) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    if (/^rw\..+\.dmg$/i.test(name)) {
      rmSync(path.join(dir, name), { force: true });
      removed.push(name);
    }
  }
  return removed;
}

export function writeFinderLayout(mountDir, spec) {
  // Vendored from ds-store (MIT). The published entrypoint always loads
  // macos-alias, a Darwin native addon; a solid background does not need it.
  const Entry = require("./vendor/ds-store/lib/entry.js");
  const Store = require("./vendor/ds-store/lib/ds-store.js");
  const store = new Store();
  const iconSize = spec.iconSize ?? 128;
  const window = {
    x: spec.windowPosition.x,
    y: spec.windowPosition.y,
    width: spec.windowSize.width,
    height: spec.windowSize.height + 22,
  };
  store.push(Entry.construct(".", "vSrn", { value: 1 }));
  store.push(Entry.construct(spec.appFileName, "Iloc", spec.appPosition));
  store.push(Entry.construct("Applications", "Iloc", spec.applicationsPosition));
  store.push(Entry.construct(".", "bwsp", window));
  store.push(
    Entry.construct(".", "icvp", {
      iconSize,
      colorComponents: [0.95, 0.95, 0.96],
    }),
  );
  const dest = path.join(mountDir, ".DS_Store");
  return new Promise((resolve, reject) => {
    store.write(dest, (err) => (err ? reject(err) : resolve(dest)));
  });
}

export async function createInstallerDmg({
  appPath,
  outputPath,
  spec,
  volumeIcon,
  staleDirs = [],
  signingIdentity,
}) {
  if (process.platform !== "darwin") {
    throw new Error("创建 DMG 需要在 macOS 上运行");
  }
  if (!existsSync(appPath)) {
    throw new Error(`找不到应用包：${appPath}`);
  }
  for (const dir of staleDirs) removeStaleRwImages(dir);

  const work = await mkdtemp(path.join(os.tmpdir(), "open-bot-dmg-"));
  const rw = path.join(work, "rw.dmg");
  let device = null;
  try {
    const sizeMb = folderSizeMb(appPath);
    await run("hdiutil", [
      "create",
      "-size",
      `${sizeMb}m`,
      "-fs",
      "HFS+",
      "-volname",
      spec.volumeName,
      "-ov",
      rw,
    ]);
    const attached = parseAttachPlist(
      await capture("hdiutil", ["attach", "-plist", "-readwrite", "-noverify", "-noautoopen", rw]),
    );
    device = attached.device;
    const mount = attached.mount;
    await run("ditto", [appPath, path.join(mount, spec.appFileName)]);
    const applicationsLink = path.join(mount, "Applications");
    await symlink("/Applications", applicationsLink);
    await writeFinderLayout(mount, spec);
    await applyVolumeIcon(mount, volumeIcon);
    await bless(mount);
    await detach(device);
    device = null;
    // hdiutil adds .dmg itself when the -o path already has that suffix.
    const outBase = outputPath.replace(/\.dmg$/i, "");
    await run("hdiutil", [
      "convert",
      rw,
      "-format",
      "UDZO",
      "-imagekey",
      "zlib-level=9",
      "-ov",
      "-o",
      outBase,
    ]);
    if (!existsSync(outputPath) && existsSync(`${outBase}.dmg`)) {
      await rename(`${outBase}.dmg`, outputPath);
    }
    if (!existsSync(outputPath)) {
      throw new Error(`hdiutil convert 没有写出 ${outputPath}`);
    }
    await codesignDmgIfNeeded(outputPath, signingIdentity);
    return outputPath;
  } finally {
    if (device) {
      try {
        await detach(device);
      } catch {
        // The image is about to be deleted with the temp dir.
      }
    }
    await rm(work, { recursive: true, force: true });
  }
}

async function applyVolumeIcon(mount, volumeIcon) {
  if (!volumeIcon || !existsSync(volumeIcon)) return;
  try {
    await copyFile(volumeIcon, path.join(mount, ".VolumeIcon.icns"));
    await run("xattr", ["-wx", "com.apple.FinderInfo", CUSTOM_ICON_FINDER_INFO, mount]);
  } catch (err) {
    console.warn(`volume icon skipped: ${err instanceof Error ? err.message : err}`);
  }
}

async function bless(mount) {
  try {
    await run("bless", ["--folder", mount, "--openfolder", mount]);
  } catch {
    try {
      await run("bless", ["--folder", mount]);
    } catch (err) {
      console.warn(`bless skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function codesignDmgIfNeeded(outputPath, signingIdentity) {
  const identity = dmgSigningIdentity(signingIdentity);
  if (!identity) return;
  await run("codesign", ["--force", "--sign", identity, outputPath]);
}

function folderSizeMb(appPath) {
  const result = spawnSync("du", ["-sm", appPath], { encoding: "utf8" });
  const size = Number(String(result.stdout).trim().split(/\s+/)[0]);
  if (!Number.isFinite(size) || size <= 0) return 256;
  return Math.max(64, Math.ceil(size * 1.5) + 32);
}

export function parseAttachPlist(xml) {
  const decoded = xml.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
  const dicts = decoded.split("<dict>").slice(1);
  for (const dict of dicts) {
    const mount = dict.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
    const device = dict.match(/<key>dev-entry<\/key>\s*<string>([^<]+)<\/string>/);
    if (mount && mount[1].startsWith("/Volumes/")) {
      return { mount: mount[1], device: device ? device[1] : null };
    }
  }
  throw new Error(`hdiutil attach 没有挂载点:\n${xml}`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}${err.trim() ? `: ${err.trim()}` : ""}`));
    });
  });
}

function capture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}${err.trim() ? `: ${err.trim()}` : ""}`));
    });
  });
}

async function detach(device) {
  if (!device) return;
  try {
    await run("hdiutil", ["detach", device]);
  } catch {
    await run("hdiutil", ["detach", "-force", device]);
  }
}
