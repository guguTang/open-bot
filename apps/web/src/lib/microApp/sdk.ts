/**
 * Injected into sandboxed iframe as openbot.micro SDK.
 * Uses window.parent.postMessage — no allow-same-origin required.
 *
 * Resize protocol (host listens; not an RPC capability):
 *   { source: "openbot.micro", type: "resize", width: number, height: number }
 * Auto: ResizeObserver + MutationObserver + load. Manual: openbot.micro.reportSize({ width?, height? }).
 * Host clamps and shrinks Dialog chrome to reported size (content-fit).
 *
 * Preferred-size measure: temporarily expand the layout containing block so
 * CSS like `min(100%, Npx)` can reveal N beyond the current iframe width;
 * height uses content metrics (not documentElement.offsetHeight) so the shell
 * can shrink when content gets shorter. See preferredSize.ts / docs §2.1.1.
 */
import {
  MICRO_SHELL_MEASURE_CHILD_SLACK_PX,
  MICRO_SHELL_MEASURE_EXPAND_EPSILON_PX,
  MICRO_SHELL_MEASURE_EXPAND_PX,
} from "./preferredSize";

export const OPENBOT_MICRO_SDK = `
(function () {
  if (window.openbot && window.openbot.micro) return;
  var pending = Object.create(null);
  var seq = 0;
  var MEASURE_EXPAND_PX = ${MICRO_SHELL_MEASURE_EXPAND_PX};
  var MEASURE_EXPAND_EPS = ${MICRO_SHELL_MEASURE_EXPAND_EPSILON_PX};
  var CHILD_SLACK_PX = ${MICRO_SHELL_MEASURE_CHILD_SLACK_PX};
  var measuring = false;

  function request(capability, params) {
    return new Promise(function (resolve, reject) {
      var id = "r" + (++seq) + "_" + Date.now();
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage(
        {
          source: "openbot.micro",
          type: "request",
          id: id,
          capability: String(capability || ""),
          params: params || {},
        },
        "*"
      );
      setTimeout(function () {
        if (!pending[id]) return;
        var p = pending[id];
        delete pending[id];
        p.reject(new Error("micro-app request timeout"));
      }, 120000);
    });
  }
  window.addEventListener("message", function (ev) {
    var data = ev.data;
    if (!data || data.source !== "openbot.micro.host" || data.type !== "response") return;
    var p = pending[data.id];
    if (!p) return;
    delete pending[data.id];
    if (data.ok) p.resolve(data.result);
    else p.reject(new Error(data.error || "request failed"));
  });

  function readContentMetrics() {
    var body = document.body;
    var w = 0;
    var h = 0;
    var childW = 0;
    var childH = 0;
    if (body) {
      var nodes = body.children;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var r = el.getBoundingClientRect();
        if (r.right > w) w = r.right;
        if (r.bottom > h) h = r.bottom;
        var cw = Math.max(el.scrollWidth || 0, r.width || 0);
        var ch = Math.max(el.scrollHeight || 0, r.height || 0);
        if (cw > childW) childW = cw;
        if (ch > childH) childH = ch;
      }
      var cs = window.getComputedStyle(body);
      h += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.marginBottom) || 0);
      w += (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.marginRight) || 0);
      w = Math.max(w, childW, body.scrollWidth || 0);
      h = Math.max(h, childH, body.scrollHeight || 0);
    }
    // Prefer intrinsic child when body/scroll is a stretched canvas.
    if (childW > 0 && childW < w - CHILD_SLACK_PX) w = childW;
    if (childH > 0 && childH < h - CHILD_SLACK_PX) h = childH;
    // Do NOT max with documentElement.offsetWidth/Height — those track the
    // iframe viewport (blocks shrink) or the temporary expand canvas.
    return { width: w, height: h };
  }

  function withExpandedMeasureBase(fn) {
    var docEl = document.documentElement;
    var body = document.body;
    if (!docEl || !body) return fn();
    var hs = docEl.style;
    var bs = body.style;
    var prev = {
      hw: hs.width, hmin: hs.minWidth, hmax: hs.maxWidth,
      bw: bs.width, bmin: bs.minWidth, bmax: bs.maxWidth
    };
    measuring = true;
    try {
      // Large fixed containing block so min(100%, Npx) resolves to N.
      hs.width = MEASURE_EXPAND_PX + "px";
      hs.minWidth = "0";
      hs.maxWidth = "none";
      bs.width = "100%";
      bs.minWidth = "0";
      bs.maxWidth = "none";
      void body.offsetWidth; // force layout
      return fn();
    } finally {
      hs.width = prev.hw;
      hs.minWidth = prev.hmin;
      hs.maxWidth = prev.hmax;
      bs.width = prev.bw;
      bs.minWidth = prev.bmin;
      bs.maxWidth = prev.bmax;
      measuring = false;
    }
  }

  function measureSize() {
    // Constrained pass: current iframe frame (fluid 100% fallback).
    var constrained = readContentMetrics();
    var expanded = withExpandedMeasureBase(readContentMetrics);
    var width = expanded.width;
    var height = expanded.height;
    // Fluid fill of expand canvas → keep current-frame width.
    if (width >= MEASURE_EXPAND_PX - MEASURE_EXPAND_EPS) {
      width = constrained.width > 0 ? constrained.width : width;
    }
    // Height: prefer expanded content metrics, but if expand stretched a
    // fluid column oddly, take the min of the two positive content heights
    // so the shell can shrink when content gets shorter.
    if (constrained.height > 0 && height > constrained.height) {
      // Expanded taller only when content actually grew under a wider base
      // (e.g. wrapping relaxed). Keep expanded.
    }
    if (constrained.height > 0 && height <= 0) height = constrained.height;
    // If both agree within slack, fine; never floor to iframe viewport.
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  var lastW = -1;
  var lastH = -1;
  var raf = 0;
  function postResize(size) {
    var width = size && size.width != null ? Number(size.width) : measureSize().width;
    var height = size && size.height != null ? Number(size.height) : measureSize().height;
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) return;
    width = Math.ceil(width);
    height = Math.ceil(height);
    if (width === lastW && height === lastH) return;
    lastW = width;
    lastH = height;
    parent.postMessage(
      { source: "openbot.micro", type: "resize", width: width, height: height },
      "*"
    );
  }
  function scheduleResize(explicit) {
    if (measuring && !explicit) return;
    if (explicit) {
      postResize(explicit);
      return;
    }
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      if (measuring) return;
      postResize(null);
    });
  }
  function reportSize(opts) {
    scheduleResize(opts || null);
  }

  function bootResize() {
    scheduleResize(null);
    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () {
        if (measuring) return;
        scheduleResize(null);
      });
      if (document.documentElement) ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }
    // Mode / class switches that change preferred size without changing the
    // constrained layout box (e.g. min(100%,720) while frame is 440) need MO.
    if (typeof MutationObserver !== "undefined" && document.body) {
      var mo = new MutationObserver(function () {
        if (measuring) return;
        scheduleResize(null);
      });
      mo.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    window.addEventListener("load", function () {
      scheduleResize(null);
    });
    window.addEventListener("resize", function () {
      if (measuring) return;
      scheduleResize(null);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootResize);
  } else {
    bootResize();
  }

  window.openbot = window.openbot || {};
  window.openbot.micro = {
    request: request,
    reportSize: reportSize,
    version: "1",
  };
})();
`.trim();

/** Host-injected: keep document content-sized (avoid 100% stretch = false tall/wide measure). */
export const OPENBOT_MICRO_SHELL_CSS = `
html, body {
  height: auto !important;
  min-height: 0 !important;
  width: auto !important;
  min-width: 0 !important;
  margin: 0;
  box-sizing: border-box;
}
`.trim();

export type MicroRuntimeFile = {
  encoding: string;
  mime: string;
  content: string;
};

/** Build iframe srcdoc: entry HTML + rewritten relative assets as blob/data URLs + SDK. */
export function buildMicroAppSrcdoc(
  entrypoint: string,
  files: Record<string, MicroRuntimeFile>,
): { srcdoc: string; revoke: () => void } {
  const blobUrls: string[] = [];
  const urlFor = (rel: string): string => {
    const f = files[rel];
    if (!f) return rel;
    let bytes: Uint8Array;
    if (f.encoding === "utf8") {
      bytes = new TextEncoder().encode(f.content);
    } else {
      const bin = atob(f.content);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: f.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    return url;
  };

  // Pre-map all files to blob URLs for attribute rewrite.
  const map: Record<string, string> = {};
  for (const rel of Object.keys(files)) {
    map[rel] = urlFor(rel);
  }

  let html = "";
  const entry = files[entrypoint];
  if (entry && entry.encoding === "utf8") {
    html = entry.content;
  } else if (entry) {
    html = new TextDecoder().decode(
      Uint8Array.from(atob(entry.content), (c) => c.charCodeAt(0)),
    );
  } else {
    html = "<!doctype html><html><body><p>missing entrypoint</p></body></html>";
  }

  // Rewrite src/href relative paths.
  html = html.replace(
    /\b(src|href)=["']([^"']+)["']/gi,
    (_m, attr: string, ref: string) => {
      if (/^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref)) {
        return `${attr}="${ref}"`;
      }
      const cleaned = ref.replace(/^\.\//, "");
      const mapped = map[cleaned] || map[entrypoint.replace(/[^/]+$/, "") + cleaned];
      if (mapped) return `${attr}="${mapped}"`;
      return `${attr}="${ref}"`;
    },
  );

  const shellCssTag = `<style data-openbot-micro-shell>${OPENBOT_MICRO_SHELL_CSS}</style>`;
  const sdkTag = `<script>${OPENBOT_MICRO_SDK}<\/script>`;
  const inject = `${shellCssTag}${sdkTag}`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${inject}</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>${inject}`);
  } else {
    html = inject + html;
  }

  return {
    srcdoc: html,
    revoke: () => {
      for (const u of blobUrls) URL.revokeObjectURL(u);
    },
  };
}
