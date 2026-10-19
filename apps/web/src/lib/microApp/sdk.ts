/**
 * Injected into sandboxed iframe as openbot.micro SDK.
 * Uses window.parent.postMessage — no allow-same-origin required.
 */
export const OPENBOT_MICRO_SDK = `
(function () {
  if (window.openbot && window.openbot.micro) return;
  var pending = Object.create(null);
  var seq = 0;
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
  window.openbot = window.openbot || {};
  window.openbot.micro = {
    request: request,
    version: "1",
  };
})();
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

  const sdkTag = `<script>${OPENBOT_MICRO_SDK}<\/script>`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${sdkTag}</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>${sdkTag}`);
  } else {
    html = sdkTag + html;
  }

  return {
    srcdoc: html,
    revoke: () => {
      for (const u of blobUrls) URL.revokeObjectURL(u);
    },
  };
}
