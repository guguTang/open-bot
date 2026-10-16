/**
 * Pure planning for the macOS desktop bundle.
 * Tauri still builds and signs the .app. The DMG step is ours because
 * Tauri's create-dmg script runs Finder via /usr/bin/osascript and exits 64
 * when Automation permission is missing, leaving rw.*.dmg behind.
 */

export function readBundleFlags(argv) {
  const bundles = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundles" || arg === "-b") {
      const value = argv[i + 1];
      if (value && !value.startsWith("-")) {
        bundles.push(
          ...value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        );
        i += 1;
      }
    } else if (arg.startsWith("--bundles=")) {
      bundles.push(
        ...arg
          .slice("--bundles=".length)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      );
    }
  }
  return bundles;
}

/** Host macOS with no triple, or an explicit `*-apple-darwin` target. */
export function buildsMacApp(argv, platform = process.platform) {
  const { target } = parseBuildFlags(argv);
  if (target) return target.includes("apple-darwin");
  return platform === "darwin";
}

/**
 * On a macOS app build, drop the Finder-scripted `dmg` target and keep `app`
 * so the caller can write a layout DMG afterwards. Windows / Linux stay unchanged.
 */
export function rewriteBuildArgs(argv, platform = process.platform) {
  if (argv[0] !== "build" || argv.includes("--no-bundle") || !buildsMacApp(argv, platform)) {
    return { argv, makeDmg: false };
  }
  const requested = readBundleFlags(argv);
  const makeDmg =
    requested.length === 0 || requested.includes("dmg") || requested.includes("all");
  if (!makeDmg) return { argv, makeDmg: false };

  const next = [];
  let replaced = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundles" || arg === "-b") {
      const value = argv[i + 1] ?? "";
      next.push("--bundles", withoutFinderDmg(value));
      i += 1;
      replaced = true;
      continue;
    }
    if (arg.startsWith("--bundles=")) {
      next.push(`--bundles=${withoutFinderDmg(arg.slice("--bundles=".length))}`);
      replaced = true;
      continue;
    }
    next.push(arg);
  }
  if (!replaced) next.splice(1, 0, "--bundles", "app");
  return { argv: next, makeDmg: true };
}

function withoutFinderDmg(value) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "dmg" && part !== "all");
  if (!parts.includes("app")) parts.unshift("app");
  return parts.join(",");
}

export function parseBuildFlags(argv) {
  let debug = false;
  let target = null;
  let profile = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--debug" || arg === "-d") debug = true;
    else if (arg === "--target") target = argv[i + 1] ?? null;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length);
    else if (arg === "--profile") profile = argv[i + 1] ?? null;
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
  }
  return { debug, target, profile };
}

export function cargoProfileDir({ debug, profile }) {
  if (profile === "dev") return "debug";
  if (profile) return profile;
  return debug ? "debug" : "release";
}

export function dmgArch({ target, hostArch }) {
  const triple = target || "";
  if (triple.includes("universal")) return "universal";
  if (triple.includes("aarch64") || triple.includes("arm")) return "aarch64";
  if (triple.includes("x86_64") || triple.includes("i686")) return "x64";
  if (hostArch === "arm64") return "aarch64";
  if (hostArch === "x64") return "x64";
  return hostArch || "unknown";
}

export function bundlePaths({ tauriDir, productName, version, argv, hostArch }) {
  const flags = parseBuildFlags(argv);
  const profileDir = cargoProfileDir(flags);
  const bundleRoot = flags.target
    ? `${tauriDir}/target/${flags.target}/${profileDir}/bundle`
    : `${tauriDir}/target/${profileDir}/bundle`;
  const arch = dmgArch({ target: flags.target, hostArch });
  return {
    appDir: `${bundleRoot}/macos`,
    dmgDir: `${bundleRoot}/dmg`,
    appPath: `${bundleRoot}/macos/${productName}.app`,
    dmgPath: `${bundleRoot}/dmg/${productName}_${version}_${arch}.dmg`,
  };
}

/** Real Developer ID signs the DMG. Ad-hoc (`-`) does not, matching Tauri. */
export function dmgSigningIdentity(configIdentity, envIdentity = process.env.APPLE_SIGNING_IDENTITY) {
  const identity = (envIdentity ?? configIdentity ?? "").trim();
  if (!identity || identity === "-") return null;
  return identity;
}

export function readDesktopConfig(conf) {
  const dmg = conf.bundle?.macOS?.dmg ?? {};
  return {
    productName: conf.productName,
    version: conf.version,
    identifier: conf.identifier,
    targets: conf.bundle?.targets ?? [],
    signingIdentity: conf.bundle?.macOS?.signingIdentity ?? null,
    hardenedRuntime: conf.bundle?.macOS?.hardenedRuntime ?? null,
    entitlements: conf.bundle?.macOS?.entitlements ?? null,
    windowSize: dmg.windowSize ?? { width: 660, height: 400 },
    windowPosition: dmg.windowPosition ?? { x: 200, y: 120 },
    appPosition: dmg.appPosition ?? { x: 180, y: 170 },
    applicationFolderPosition: dmg.applicationFolderPosition ?? { x: 480, y: 170 },
  };
}
