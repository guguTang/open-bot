import { useEffect, useState } from "react";
import { exchangeOIDCCode, setSession } from "../api";

export default function AuthCallback() {
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || "";
    const state = params.get("state") || "";
    if (!code) {
      setError("缺少授权码 code");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await exchangeOIDCCode(code, state);
        if (cancelled) return;
        setSession(res.token, res.user);
        window.location.replace("/");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid min-h-full place-items-center bg-[radial-gradient(ellipse_at_20%_0%,rgba(124,58,237,0.1),transparent_50%),radial-gradient(ellipse_at_80%_100%,rgba(167,139,250,0.08),transparent_45%),var(--bg)] p-6">
      <div className="flex w-[min(400px,100%)] flex-col gap-3 rounded-2xl border border-(--border) bg-(--bg-elevated) p-6 shadow-(--shadow-md)">
        <div className="flex items-center gap-2.5 pb-2">
          <div className="grid size-9 place-items-center rounded-[10px] bg-linear-to-br from-(--accent) to-(--accent-2) font-bold text-white">
            ◈
          </div>
          <div>
            <div className="font-bold tracking-[0.02em]">open-bot</div>
            <div className="text-xs text-(--muted)">正在完成 Casdoor 登录…</div>
          </div>
        </div>
        {error ? (
          <>
            <div className="text-[13px] text-(--danger)">{error}</div>
            <a
              className="inline-block cursor-pointer rounded-xl border-none bg-(--accent) px-3.5 py-2.5 text-center text-white no-underline"
              href="/"
            >
              返回登录
            </a>
          </>
        ) : (
          <p className="text-[13px] text-(--muted)">请稍候</p>
        )}
      </div>
    </div>
  );
}
