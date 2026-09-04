import { useCallback, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Maximize2, Plus, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { navigateToChatDraft, navigateToRememberedChat } from "@/chat-runtime/navigation";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ChatBuildModeSwitch, type PaseoProductMode } from "@/components/headers/paseo-mode-switch";
import { usePaseoMountEnvironment, usePaseoMountSnapshot } from "@/embedded/mount-environment";
import { PaseoShellPortal } from "@/embedded/paseo-shell-portal";
import {
  getLastWorkspaceSelection,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { buildHostRootRoute } from "@/utils/host-routes";

/**
 * Shared Chat/Build product header. It owns only product-mode navigation and an
 * opaque Host close request; workspace actions remain injected by Build and are
 * absent in Chat.
 */

export { ChatBuildModeSwitch, type PaseoProductMode } from "@/components/headers/paseo-mode-switch";

const mutedIconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedMaximize2 = withUnistyles(Maximize2, mutedIconColorMapping);
const ThemedPlus = withUnistyles(Plus, mutedIconColorMapping);
const ThemedX = withUnistyles(X, mutedIconColorMapping);
const NO_SHORTCUT_KEYS: [] = [];

export function PaseoProductHeader({
  serverId,
  mode,
  actions,
}: {
  serverId: string;
  mode: PaseoProductMode;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const controller = usePaseoMountEnvironment();
  const mountSnapshot = usePaseoMountSnapshot();
  const isCompactSurface = mountSnapshot?.surface === "compact";
  const handleChat = useCallback(() => {
    if (mode !== "chat") navigateToRememberedChat(serverId);
  }, [mode, serverId]);
  const handleNewChat = useCallback(() => {
    navigateToChatDraft(serverId);
  }, [serverId]);
  const handleBuild = useCallback(() => {
    if (mode === "build") return;
    const selection = getLastWorkspaceSelection();
    if (selection?.serverId === serverId) {
      navigateToWorkspace(selection);
      return;
    }
    router.navigate(buildHostRootRoute(serverId));
  }, [mode, router, serverId]);
  const handleOpenFull = useCallback(() => {
    controller?.callbacks.requestSurface("full");
  }, [controller]);
  const handleClose = useCallback(() => {
    if (controller && mountSnapshot?.surface === "full") {
      controller.callbacks.requestSurface("compact");
      return;
    }
    if (controller) {
      controller.callbacks.requestMinimize();
      return;
    }
    router.navigate(buildHostRootRoute(serverId));
  }, [controller, mountSnapshot?.surface, router, serverId]);

  const fullLeft = useMemo(
    () => (
      <SidebarMenuToggle
        forceVisible
        vibesIcon
        style={styles.touchTarget}
        testID="paseo-product-menu"
        nativeID="paseo-product-menu"
      />
    ),
    [],
  );
  const compactLeft = useMemo(
    () => (
      <HeaderToggleButton
        onPress={handleNewChat}
        tooltipLabel="New chat"
        tooltipKeys={NO_SHORTCUT_KEYS}
        tooltipSide="bottom"
        style={styles.touchTarget}
        testID="paseo-new-chat"
        nativeID="paseo-new-chat"
        accessibilityRole="button"
        accessibilityLabel="New chat"
      >
        <ThemedPlus size={18} />
      </HeaderToggleButton>
    ),
    [handleNewChat],
  );
  const center = useMemo(
    () => <ChatBuildModeSwitch mode={mode} onChat={handleChat} onBuild={handleBuild} />,
    [handleBuild, handleChat, mode],
  );
  const closeButton = useMemo(
    () => (
      <HeaderToggleButton
        onPress={handleClose}
        tooltipLabel="Close Paseo"
        tooltipKeys={NO_SHORTCUT_KEYS}
        tooltipSide="bottom"
        style={styles.touchTarget}
        testID="paseo-product-close"
        nativeID="paseo-product-close"
        accessibilityRole="button"
        accessibilityLabel="Close Paseo"
      >
        <ThemedX size={18} />
      </HeaderToggleButton>
    ),
    [handleClose],
  );
  const fullRight = useMemo(
    () => (
      <View style={styles.actions}>
        {actions}
        {closeButton}
      </View>
    ),
    [actions, closeButton],
  );
  const compactRight = useMemo(
    () => (
      <View style={styles.actions}>
        <HeaderToggleButton
          onPress={handleOpenFull}
          tooltipLabel="Open full Paseo"
          tooltipKeys={NO_SHORTCUT_KEYS}
          tooltipSide="bottom"
          style={styles.touchTarget}
          testID="paseo-open-full"
          nativeID="paseo-open-full"
          accessibilityRole="button"
          accessibilityLabel="Open full Paseo"
        >
          <ThemedMaximize2 size={18} />
        </HeaderToggleButton>
        {closeButton}
      </View>
    ),
    [closeButton, handleOpenFull],
  );
  if (!isFocused) return null;

  const header = (
    <ScreenHeader
      left={isCompactSurface ? compactLeft : fullLeft}
      center={center}
      right={isCompactSurface ? compactRight : fullRight}
      leftStyle={styles.left}
      rightStyle={styles.right}
    />
  );
  const compactHeaderSlot = controller?.shellSlots?.productHeader;
  if (mountSnapshot?.surface === "compact" && compactHeaderSlot) {
    return <PaseoShellPortal slot={compactHeaderSlot}>{header}</PaseoShellPortal>;
  }
  return header;
}

const styles = StyleSheet.create((theme) => ({
  left: {
    flex: 1,
  },
  right: {
    flex: 1,
    justifyContent: "flex-end",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  touchTarget: {
    width: 44,
    height: 44,
  },
}));
