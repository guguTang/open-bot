/**
 * OpenUI (@openuidev/react-lang) auto-mounts an "Inspect/Debug" FAB in dev builds.
 * It floats over every screen (login, settings hub, composer), so keep it off unless
 * explicitly opted in: localStorage.setItem("openui.devtools", "1") then reload.
 * Must be imported before anything that pulls in @openuidev/react-lang.
 */
let optIn = false;
try {
  optIn = globalThis.localStorage?.getItem("openui.devtools") === "1";
} catch {
  optIn = false;
}
if (optIn) {
  document.documentElement.setAttribute("data-openui-devtools", "");
} else {
  (globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
}
export {};
