export interface PairingQrScanPlatform {
  isNative: boolean;
  isFdroidBuild: boolean;
  isElectron: boolean;
  isCompactFormFactor: boolean;
}

export function shouldOfferPairingQrScan({
  isNative,
  isFdroidBuild,
  isElectron,
  isCompactFormFactor,
}: PairingQrScanPlatform): boolean {
  if (isElectron || isFdroidBuild) return false;
  return isNative || isCompactFormFactor;
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
