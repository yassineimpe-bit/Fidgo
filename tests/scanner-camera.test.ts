import { describe, expect, it, vi } from "vitest";
import {
  classifyCameraError,
  extractLoyaltyQr,
  isDuplicateQr,
  stopMediaStream,
} from "@/lib/scanner-camera";

function namedError(name: string) {
  return { name };
}

describe("scanner camera helpers", () => {
  it("distinguishes camera permission, hardware and lifecycle failures", () => {
    const available = { secureContext: true, mediaDevicesAvailable: true };
    expect(classifyCameraError(namedError("NotAllowedError"), available)).toBe("denied");
    expect(classifyCameraError(namedError("NotFoundError"), available)).toBe("no-camera");
    expect(classifyCameraError(namedError("NotReadableError"), available)).toBe("occupied");
    expect(classifyCameraError(namedError("AbortError"), available)).toBe("start-failed");
    expect(classifyCameraError(null, { ...available, secureContext: false })).toBe("insecure");
    expect(classifyCameraError(null, { ...available, mediaDevicesAvailable: false })).toBe("unsupported");
  });

  it("extracts only strict Retiko QR payloads", () => {
    const token = "abcdefghijklmnopqrstuv";
    expect(extractLoyaltyQr(`  LOY1:${token}\n`)).toBe(`LOY1:${token}`);
    expect(extractLoyaltyQr(token)).toBeNull();
    expect(extractLoyaltyQr(`https://retiko.fr/c/${token}`)).toBeNull();
    expect(extractLoyaltyQr("LOY1:too-short")).toBeNull();
  });

  it("suppresses an immediate duplicate but accepts the next customer", () => {
    const previous = { value: "LOY1:abcdefghijklmnopqrstuv", at: 1_000 };
    expect(isDuplicateQr(previous, previous.value, 4_999)).toBe(true);
    expect(isDuplicateQr(previous, previous.value, 5_000)).toBe(false);
    expect(isDuplicateQr(previous, "LOY1:zyxwvutsrqponmlkjihgfe", 1_100)).toBe(false);
  });

  it("stops every media track when leaving the scanner", () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    stopMediaStream({ getTracks: () => [first, second] } as unknown as MediaStream);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});
