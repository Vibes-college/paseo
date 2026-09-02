import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BarcodeScanningResult, BarcodeSettings } from "expo-camera";
import { useHostMutations } from "@/runtime/host-runtime";
import { decodeOfferFragmentPayload, normalizeHostPort } from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { ConnectionOfferSchema } from "@getpaseo/protocol/connection-offer";
import { buildHostRootRoute, buildSettingsHostRoute } from "@/utils/host-routes";
import { getIsElectron, isWeb } from "@/constants/platform";
import { BackHeader } from "@/components/headers/back-header";
import { canUsePairingQrCamera } from "@/utils/pairing-scan-platform";

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
  },
  cameraWrap: {
    flex: 1,
    overflow: "hidden",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 260,
    height: 260,
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: theme.colors.accent,
  },
  cornerTL: {
    left: 0,
    top: 0,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    right: 0,
    top: 0,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    right: 0,
    bottom: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 12,
  },
  helperText: {
    marginTop: theme.spacing[6],
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
  permissionCard: {
    marginTop: theme.spacing[6],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[4],
  },
  permissionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  permissionBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  permissionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  permissionButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.palette.blue[500],
  },
  secondaryButton: {
    backgroundColor: theme.colors.surface3,
  },
  permissionButtonText: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.semibold,
  },
  secondaryButtonText: {
    color: theme.colors.foreground,
  },
}));

function extractOfferUrlFromScan(result: BarcodeScanningResult): string | null {
  const raw = typeof result.data === "string" ? result.data.trim() : "";
  if (!raw) return null;

  if (raw.includes("#offer=")) return raw;

  return null;
}

export default function PairScanScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string;
  }>();
  const source = typeof params.source === "string" ? params.source : "settings";
  const { upsertConnectionFromOfferUrl: upsertDaemonFromOfferUrl } = useHostMutations();

  const [permission, requestPermission] = useCameraPermissions();
  const [isPairing, setIsPairing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanPaused, setIsScanPaused] = useState(false);
  const lastScannedRef = useRef<string | null>(null);
  const cameraAvailable =
    !getIsElectron() &&
    canUsePairingQrCamera({
      isWeb,
      isSecureContext: !isWeb || (typeof window !== "undefined" && window.isSecureContext),
      hasGetUserMedia:
        !isWeb ||
        (typeof navigator !== "undefined" &&
          typeof navigator.mediaDevices?.getUserMedia === "function"),
    });

  const navigateToPairedHost = useCallback(
    (serverId: string) => {
      if (source === "onboarding") {
        router.replace(buildHostRootRoute(serverId));
        return;
      }
      router.replace(buildSettingsHostRoute(serverId));
    },
    [router, source],
  );

  const closeToSource = useCallback(() => {
    try {
      router.back();
    } catch {
      router.replace("/" as Href);
    }
  }, [router]);

  useEffect(() => {
    if (isWeb) return;
    if (permission && permission.granted) return;
    void requestPermission().catch(() => undefined);
  }, [permission, requestPermission]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (isPairing || isScanPaused) return;
      const offerUrl = extractOfferUrlFromScan(result);
      if (!offerUrl) return;

      if (lastScannedRef.current === offerUrl) return;
      lastScannedRef.current = offerUrl;
      setScanError(null);
      setIsScanPaused(true);

      try {
        setIsPairing(true);
        const idx = offerUrl.indexOf("#offer=");
        const encoded = offerUrl.slice(idx + "#offer=".length).trim();
        const offerPayload = decodeOfferFragmentPayload(encoded);
        const offer = ConnectionOfferSchema.parse(offerPayload);

        const { client, hostname } = await connectToDaemon(
          {
            id: "probe",
            type: "relay",
            relayEndpoint: normalizeHostPort(offer.relay.endpoint),
            useTls: offer.relay.useTls,
            daemonPublicKeyB64: offer.daemonPublicKeyB64,
          },
          { serverId: offer.serverId },
        );
        await client.close().catch(() => undefined);

        const profile = await upsertDaemonFromOfferUrl(offerUrl, hostname ?? undefined);
        navigateToPairedHost(profile.serverId);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("pairing.scan.unableToPair");
        if (isWeb) {
          setScanError(message);
        } else {
          lastScannedRef.current = null;
          setIsScanPaused(false);
          Alert.alert(t("pairing.scan.errorTitle"), message);
        }
      } finally {
        setIsPairing(false);
      }
    },
    [isPairing, isScanPaused, navigateToPairedHost, t, upsertDaemonFromOfferUrl],
  );

  const handleRouterBack = useCallback(() => router.back(), [router]);
  const handleRequestPermission = useCallback(() => {
    setScanError(null);
    void requestPermission()
      .then((nextPermission) => {
        if (!nextPermission.granted) {
          setScanError(t("pairing.scan.webUnavailableBody"));
        }
        return nextPermission;
      })
      .catch((error) => {
        setScanError(error instanceof Error ? error.message : t("pairing.scan.webUnavailableBody"));
      });
  }, [requestPermission, t]);
  const handleCameraMountError = useCallback(
    ({ message }: { message: string }) => {
      setIsScanPaused(true);
      setScanError(message || t("pairing.scan.webUnavailableBody"));
    },
    [t],
  );
  const handleRetry = useCallback(() => {
    lastScannedRef.current = null;
    setScanError(null);
    setIsScanPaused(false);
  }, []);

  const bodyStyle = useMemo(
    () => [styles.body, { paddingBottom: insets.bottom + theme.spacing[6] }],
    [insets.bottom, theme.spacing],
  );
  const helperTextStyle = useMemo(
    () => [styles.helperText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );

  if (!cameraAvailable) {
    return (
      <View style={styles.container}>
        <BackHeader title={t("pairing.scan.title")} onBack={handleRouterBack} />
        <View style={bodyStyle}>
          <View
            style={styles.permissionCard}
            accessibilityRole="alert"
            testID="pair-scan-unavailable"
          >
            <Text style={styles.permissionTitle}>{t("pairing.scan.webUnavailableTitle")}</Text>
            <Text style={styles.permissionBody}>{t("pairing.scan.webUnavailableBody")}</Text>
            <Pressable
              style={styles.permissionButton}
              onPress={closeToSource}
              accessibilityRole="button"
              testID="pair-scan-back"
            >
              <Text style={styles.permissionButtonText}>{t("pairing.scan.backToSettings")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const granted = Boolean(permission?.granted);
  let scannerContent: ReactNode;
  if (scanError) {
    scannerContent = (
      <View style={styles.permissionCard} accessibilityRole="alert" testID="pair-scan-error">
        <Text style={styles.permissionTitle}>{t("pairing.scan.errorTitle")}</Text>
        <Text style={styles.permissionBody}>{scanError}</Text>
        <View style={styles.permissionActions}>
          <Pressable
            style={styles.permissionButton}
            onPress={handleRetry}
            accessibilityRole="button"
            testID="pair-scan-retry"
          >
            <Text style={styles.permissionButtonText}>{t("pairing.device.retry")}</Text>
          </Pressable>
          <Pressable
            style={[styles.permissionButton, styles.secondaryButton]}
            onPress={closeToSource}
            accessibilityRole="button"
            testID="pair-scan-back"
          >
            <Text style={[styles.permissionButtonText, styles.secondaryButtonText]}>
              {t("pairing.scan.backToSettings")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  } else if (!granted) {
    scannerContent = (
      <View style={styles.permissionCard} testID="pair-scan-permission">
        <Text style={styles.permissionTitle}>{t("pairing.scan.cameraPermissionTitle")}</Text>
        <Text style={styles.permissionBody}>{t("pairing.scan.cameraPermissionBody")}</Text>
        <Pressable
          style={styles.permissionButton}
          onPress={handleRequestPermission}
          accessibilityRole="button"
          testID="pair-scan-grant"
        >
          <Text style={styles.permissionButtonText}>{t("pairing.scan.grantPermission")}</Text>
        </Pressable>
      </View>
    );
  } else {
    scannerContent = (
      <View style={styles.cameraWrap} testID="pair-scan-camera">
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={BARCODE_SCANNER_SETTINGS}
          onBarcodeScanned={isScanPaused ? undefined : handleScan}
          onMountError={handleCameraMountError}
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          {isPairing ? <Text style={helperTextStyle}>{t("pairing.scan.pairing")}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BackHeader title={t("pairing.scan.title")} onBack={closeToSource} />
      <View style={bodyStyle}>{scannerContent}</View>
    </View>
  );
}

const BARCODE_SCANNER_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };
