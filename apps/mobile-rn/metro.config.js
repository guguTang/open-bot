const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = __dirname;
// open-bot monorepo 根目录（apps/mobile-rn -> apps -> open-bot）
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 让 Metro 看得见 workspace 根，pnpm 提升到根部的依赖才能被解析到。
// 代价是会监听整个仓库；装了 watchman 会快很多（brew install watchman）。
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
});
