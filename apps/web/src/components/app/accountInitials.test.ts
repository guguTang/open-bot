import { describe, expect, it } from "vitest";
import { accountInitials } from "./accountInitials";

describe("accountInitials", () => {
  it("returns placeholder for empty input", () => {
    expect(accountInitials("")).toBe("?");
    expect(accountInitials("   ")).toBe("?");
  });

  it("takes up to two graphemes from the display name", () => {
    expect(accountInitials("Alice")).toBe("Al");
    expect(accountInitials("  Bob  ")).toBe("Bo");
  });
});
