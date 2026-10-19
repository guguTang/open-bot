/**
 * Capacitor device bridges for micro-app RPCs.
 * Uses runtime Plugins registry — works when native shell registers
 * Camera / LocalNotifications / Share; otherwise callers grey out via capabilities.ts.
 */

type CapPlugins = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

function plugins(): CapPlugins | null {
  if (typeof window === "undefined") return null;
  return (window.Capacitor?.Plugins as CapPlugins) || null;
}

export async function deviceCameraGetPhoto(params: Record<string, unknown> = {}): Promise<unknown> {
  const Camera = plugins()?.Camera;
  if (!Camera) throw new Error("Camera 插件未接入");
  const getPhoto = Camera.getPhoto || Camera.takePicture;
  if (typeof getPhoto !== "function") throw new Error("Camera.getPhoto 不可用");
  return getPhoto.call(Camera, {
    quality: Number(params.quality ?? 80),
    allowEditing: Boolean(params.allowEditing ?? false),
    resultType: String(params.resultType || "base64"),
    source: String(params.source || "prompt"), // prompt | camera | photos
  });
}

export async function deviceNotify(params: Record<string, unknown> = {}): Promise<unknown> {
  const LocalNotifications = plugins()?.LocalNotifications;
  if (!LocalNotifications) throw new Error("LocalNotifications 插件未接入");
  if (typeof LocalNotifications.requestPermissions === "function") {
    await LocalNotifications.requestPermissions();
  }
  if (typeof LocalNotifications.schedule !== "function") {
    throw new Error("LocalNotifications.schedule 不可用");
  }
  const id = Number(params.id ?? Date.now() % 1_000_000);
  const title = String(params.title || "open bot");
  const body = String(params.body || params.message || "");
  return LocalNotifications.schedule({
    notifications: [
      {
        id,
        title,
        body,
        schedule: params.at ? { at: new Date(String(params.at)) } : undefined,
      },
    ],
  });
}

export async function deviceShare(params: Record<string, unknown> = {}): Promise<unknown> {
  const Share = plugins()?.Share;
  if (!Share || typeof Share.share !== "function") throw new Error("Share 插件未接入");
  return Share.share({
    title: params.title != null ? String(params.title) : undefined,
    text: params.text != null ? String(params.text) : params.message != null ? String(params.message) : undefined,
    url: params.url != null ? String(params.url) : undefined,
    dialogTitle: params.dialogTitle != null ? String(params.dialogTitle) : undefined,
  });
}
