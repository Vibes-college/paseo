import { describe, expect, it } from "vitest";
import { canUsePairingQrCamera, shouldOfferPairingQrScan } from "./pairing-scan-platform";

describe("pairing QR scan platform policy", () => {
  it.each([
    {
      label: "ordinary browser web",
      input: { isNative: false, isFdroidBuild: false, isElectron: false },
      expected: true,
    },
    {
      label: "native App Store build",
      input: { isNative: true, isFdroidBuild: false, isElectron: false },
      expected: true,
    },
    {
      label: "native F-Droid build",
      input: { isNative: true, isFdroidBuild: true, isElectron: false },
      expected: false,
    },
    {
      label: "Electron desktop",
      input: { isNative: false, isFdroidBuild: false, isElectron: true },
      expected: false,
    },
  ])("returns $expected for $label", ({ input, expected }) => {
    expect(shouldOfferPairingQrScan(input)).toBe(expected);
  });

  it.each([
    {
      label: "native camera",
      input: { isWeb: false, isSecureContext: false, hasGetUserMedia: false },
      expected: true,
    },
    {
      label: "secure browser camera",
      input: { isWeb: true, isSecureContext: true, hasGetUserMedia: true },
      expected: true,
    },
    {
      label: "insecure browser context",
      input: { isWeb: true, isSecureContext: false, hasGetUserMedia: true },
      expected: false,
    },
    {
      label: "browser without getUserMedia",
      input: { isWeb: true, isSecureContext: true, hasGetUserMedia: false },
      expected: false,
    },
  ])("camera availability is $expected for $label", ({ input, expected }) => {
    expect(canUsePairingQrCamera(input)).toBe(expected);
  });
});
