/**
 * Capacitor device bridges for micro-app RPCs.
 * Uses runtime Plugins registry — works when native shell registers
 * Camera / LocalNotifications / Share / Microphone|VoiceRecorder|SpeechRecognition / Geolocation;
 * otherwise callers grey out via capabilities.ts.
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

export async function deviceMicCapture(params: Record<string, unknown> = {}): Promise<unknown> {
  const p = plugins();
  if (!p) throw new Error("麦克风插件未接入");

  // Prefer dedicated Microphone / VoiceRecorder; fall back to SpeechRecognition start/stop.
  const Microphone = p.Microphone || p.VoiceRecorder;
  if (Microphone) {
    if (typeof Microphone.requestPermissions === "function") {
      await Microphone.requestPermissions();
    }
    if (typeof Microphone.startRecording === "function") {
      await Microphone.startRecording(params);
      const stop =
        typeof Microphone.stopRecording === "function"
          ? Microphone.stopRecording
          : typeof Microphone.stop === "function"
            ? Microphone.stop
            : null;
      if (!stop) throw new Error("Microphone.stopRecording 不可用");
      // Caller may pass duration_ms; otherwise stop immediately after start (plugin-dependent).
      const waitMs = Number(params.duration_ms ?? params.durationMs ?? 0);
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
      }
      return stop.call(Microphone);
    }
  }

  const Speech = p.SpeechRecognition;
  if (Speech && typeof Speech.start === "function") {
    if (typeof Speech.requestPermissions === "function") {
      await Speech.requestPermissions();
    }
    return Speech.start({
      language: String(params.language || "zh-CN"),
      maxResults: Number(params.maxResults ?? 1),
      prompt: params.prompt != null ? String(params.prompt) : undefined,
      partialResults: Boolean(params.partialResults ?? false),
      popup: Boolean(params.popup ?? true),
    });
  }

  throw new Error("Microphone / VoiceRecorder / SpeechRecognition 插件未接入");
}

export async function deviceGeoGetCurrentPosition(
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const Geolocation = plugins()?.Geolocation;
  if (!Geolocation || typeof Geolocation.getCurrentPosition !== "function") {
    throw new Error("Geolocation 插件未接入");
  }
  if (typeof Geolocation.requestPermissions === "function") {
    await Geolocation.requestPermissions();
  }
  return Geolocation.getCurrentPosition({
    enableHighAccuracy: Boolean(params.enableHighAccuracy ?? true),
    timeout: Number(params.timeout ?? 15_000),
    maximumAge: Number(params.maximumAge ?? 0),
  });
}
