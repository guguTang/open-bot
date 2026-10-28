#!/usr/bin/env node
/**
 * Rewrite the Tauri bundle version when RELEASE_VERSION is set.
 * No-op otherwise, so local `make build-desktop` keeps tauri.conf.json.
 *
 * RELEASE_VERSION is semver without a leading v: 1.2.3 or 1.2.3-rc.1.
 * The desktop DMG script reads the version from tauri.conf.json, not from
 * a Tauri CLI override, so the file itself has to change before `tauri build`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const raw = (process.env.RELEASE_VERSION || "").trim();
if (!raw) process.exit(0);

const version = raw.replace(/^v/, "");
if (!/^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`RELEASE_VERSION must be semver (no leading v), got ${JSON.stringify(raw)}`);
  process.exit(1);
}

const confPath = "apps/desktop/src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

const cargoPath = "apps/desktop/src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const updated = cargo.replace(
  /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
  `$1${version}$2`,
);
if (updated === cargo) {
  console.error(`failed to update version in ${cargoPath}`);
  process.exit(1);
}
writeFileSync(cargoPath, updated);
console.log(`desktop version set to ${version}`);
