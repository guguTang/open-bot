import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundlePaths,
  dmgSigningIdentity,
  readDesktopConfig,
  rewriteBuildArgs,
} from "./lib/bundle-plan.mjs";
import { parseAttachPlist, removeStaleRwImages, writeFinderLayout } from "./macos-dmg.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conf = readDesktopConfig(
  JSON.parse(readFileSync(path.join(desktopRoot, "src-tauri", "tauri.conf.json"), "utf8")),
);

test("bundle identity stays com.openbot.desktop and requests app plus dmg", () => {
  assert.equal(conf.productName, "Open Bot");
  assert.equal(conf.identifier, "com.openbot.desktop");
  assert.deepEqual(conf.targets, ["app", "dmg"]);
  assert.equal(conf.signingIdentity, "-");
  assert.equal(conf.hardenedRuntime, true);
  assert.equal(conf.entitlements, "Entitlements.plist");
  assert.deepEqual(conf.appPosition, { x: 180, y: 170 });
  assert.deepEqual(conf.applicationFolderPosition, { x: 480, y: 170 });

  const plist = readFileSync(path.join(desktopRoot, "src-tauri", "Info.plist"), "utf8");
  assert.match(plist, /<key>CFBundleIdentifier<\/key>\s*<string>com\.openbot\.desktop<\/string>/);
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Open Bot<\/string>/);
  assert.match(plist, /NSScreenCaptureUsageDescription/);

  const entitlements = readFileSync(path.join(desktopRoot, "src-tauri", "Entitlements.plist"), "utf8");
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.automation\.apple-events/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.app-sandbox/);
});

test("ad-hoc builds do not sign the DMG; a Developer ID does", () => {
  assert.equal(dmgSigningIdentity("-"), null);
  assert.equal(dmgSigningIdentity("-", ""), null);
  assert.equal(dmgSigningIdentity("-", "Developer ID Application: Open Bot (TEAMID)"), "Developer ID Application: Open Bot (TEAMID)");
  assert.equal(dmgSigningIdentity("Developer ID Application: Open Bot (TEAMID)", undefined), "Developer ID Application: Open Bot (TEAMID)");
});

test("macOS build replaces Finder dmg with the app bundle only", () => {
  assert.deepEqual(rewriteBuildArgs(["build"], "darwin"), {
    argv: ["build", "--bundles", "app"],
    makeDmg: true,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--debug"], "darwin"), {
    argv: ["build", "--bundles", "app", "--debug"],
    makeDmg: true,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--bundles", "dmg"], "darwin"), {
    argv: ["build", "--bundles", "app"],
    makeDmg: true,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--bundles", "app,dmg"], "darwin"), {
    argv: ["build", "--bundles", "app"],
    makeDmg: true,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--bundles=app,nsis,dmg"], "darwin"), {
    argv: ["build", "--bundles=app,nsis"],
    makeDmg: true,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--bundles", "app"], "darwin"), {
    argv: ["build", "--bundles", "app"],
    makeDmg: false,
  });
  assert.deepEqual(rewriteBuildArgs(["build", "--no-bundle"], "darwin"), {
    argv: ["build", "--no-bundle"],
    makeDmg: false,
  });
  assert.deepEqual(rewriteBuildArgs(["dev"], "darwin"), { argv: ["dev"], makeDmg: false });
});

test("Windows and Linux bundle args stay untouched, including on a Mac host", () => {
  const win = ["build", "--target", "x86_64-pc-windows-msvc"];
  const linux = ["build", "--target", "x86_64-unknown-linux-gnu"];
  assert.deepEqual(rewriteBuildArgs(win, "win32"), { argv: win, makeDmg: false });
  assert.deepEqual(rewriteBuildArgs(win, "darwin"), { argv: win, makeDmg: false });
  assert.deepEqual(rewriteBuildArgs(linux, "linux"), { argv: linux, makeDmg: false });
  assert.deepEqual(rewriteBuildArgs(linux, "darwin"), { argv: linux, makeDmg: false });
  assert.deepEqual(rewriteBuildArgs(["build", "--target", "x86_64-apple-darwin"], "darwin"), {
    argv: ["build", "--bundles", "app", "--target", "x86_64-apple-darwin"],
    makeDmg: true,
  });
});

test("dmg filename follows the Tauri app bundle path", () => {
  const release = bundlePaths({
    tauriDir: "/src-tauri",
    productName: "Open Bot",
    version: "0.1.0",
    argv: ["build"],
    hostArch: "arm64",
  });
  assert.equal(release.appPath, "/src-tauri/target/release/bundle/macos/Open Bot.app");
  assert.equal(release.dmgPath, "/src-tauri/target/release/bundle/dmg/Open Bot_0.1.0_aarch64.dmg");

  const debug = bundlePaths({
    tauriDir: "/src-tauri",
    productName: "Open Bot",
    version: "0.1.0",
    argv: ["build", "--debug", "--target", "x86_64-apple-darwin"],
    hostArch: "arm64",
  });
  assert.equal(
    debug.dmgPath,
    "/src-tauri/target/x86_64-apple-darwin/debug/bundle/dmg/Open Bot_0.1.0_x64.dmg",
  );
});

test("attach plist keeps a volume path that contains spaces", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>system-entities</key><array>
<dict><key>dev-entry</key><string>/dev/disk4</string></dict>
<dict>
  <key>dev-entry</key><string>/dev/disk4s1</string>
  <key>mount-point</key><string>/Volumes/Open Bot</string>
</dict>
</array></dict></plist>`;
  assert.deepEqual(parseAttachPlist(xml), {
    mount: "/Volumes/Open Bot",
    device: "/dev/disk4s1",
  });
});

test("stale rw disk images from a failed Finder DMG are removed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "open-bot-rw-"));
  try {
    writeFileSync(path.join(dir, "rw.1234.Open Bot.dmg"), "junk");
    writeFileSync(path.join(dir, "Open Bot_0.1.0_aarch64.dmg"), "keep");
    assert.deepEqual(removeStaleRwImages(dir), ["rw.1234.Open Bot.dmg"]);
    assert.equal(statSync(path.join(dir, "Open Bot_0.1.0_aarch64.dmg")).isFile(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finder layout writes a DS_Store without launching Finder", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "open-bot-ds-"));
  try {
    const written = await writeFinderLayout(dir, {
      appFileName: "Open Bot.app",
      windowSize: conf.windowSize,
      windowPosition: conf.windowPosition,
      appPosition: conf.appPosition,
      applicationsPosition: conf.applicationFolderPosition,
      iconSize: 128,
    });
    assert.equal(written, path.join(dir, ".DS_Store"));
    assert.ok(statSync(written).size > 32);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
