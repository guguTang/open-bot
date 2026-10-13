import { describe, expect, it, vi } from "vitest";
import { resolveDialogDismiss } from "./useDialogOpen";

describe("resolveDialogDismiss", () => {
  it("blocks when busy", () => {
    expect(resolveDialogDismiss({ blockDismiss: true })).toBe("blocked");
  });

  it("keeps open when onDismiss returns false", () => {
    const onDismiss = vi.fn(() => false as const);
    expect(resolveDialogDismiss({ onDismiss })).toBe("nested");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("closes when onDismiss allows", () => {
    expect(resolveDialogDismiss({ onDismiss: () => undefined })).toBe("close");
    expect(resolveDialogDismiss({})).toBe("close");
  });
});
