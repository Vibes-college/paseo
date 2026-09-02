export interface PairingQrScanPlatform {
  isNative: boolean;
  isFdroidBuild: boolean;
  isElectron: boolean;
}

export function shouldOfferPairingQrScan({
  isNative,
  isFdroidBuild,
  isElectron,
}: PairingQrScanPlatform): boolean {
  if (isNative) return !isFdroidBuild;
  return !isElectron;
}

export interface PairingQrCameraEnvironment {
  isWeb: boolean;
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}

export function canUsePairingQrCamera({
  isWeb,
  isSecureContext,
  hasGetUserMedia,
}: PairingQrCameraEnvironment): boolean {
  if (!isWeb) return true;
  return isSecureContext && hasGetUserMedia;
}
