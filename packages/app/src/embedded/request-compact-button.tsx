import { useCallback } from "react";
import { X } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { usePaseoMountEnvironment, usePaseoMountSnapshot } from "./mount-environment";

const ThemedX = withUnistyles(X);

export function PaseoRequestCompactButton() {
  const controller = usePaseoMountEnvironment();
  const snapshot = usePaseoMountSnapshot();
  const requestCompact = useCallback(() => {
    controller?.callbacks.requestSurface("compact");
  }, [controller]);
  if (!controller || snapshot?.surface !== "full") return null;

  return (
    <HeaderToggleButton
      testID="paseo-request-compact"
      onPress={requestCompact}
      tooltipLabel="Return to Compact"
      tooltipKeys={[]}
      tooltipSide="left"
      accessible
      accessibilityRole="button"
      accessibilityLabel="Return to Compact"
    >
      <ThemedX
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
