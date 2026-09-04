import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { PanelLeft } from "lucide-react-native";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton, headerIconSlotStyle } from "./header-toggle-button";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { useHasWindowChromeObstruction, useOwnsWindowChromeCorner } from "@/utils/desktop-window";
import { iconButtonChromeGlyphSize } from "@/components/ui/icon-button-chrome";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
  forceVisible?: boolean;
  vibesIcon?: boolean;
}

const MOBILE_MENU_LINE_WIDTH = 16;
const MOBILE_MENU_LINE_HEIGHT = 1.5;

function MobileMenuIcon({ color }: { color: string }) {
  const lineStyle = useMemo(() => [styles.mobileMenuLine, { backgroundColor: color }], [color]);
  return (
    <View style={styles.mobileMenuIcon} pointerEvents="none" testID="vibes-menu-icon">
      <View style={lineStyle} testID="vibes-menu-icon-line" />
      <View style={lineStyle} testID="vibes-menu-icon-line" />
      <View style={lineStyle} testID="vibes-menu-icon-line" />
    </View>
  );
}

function SidebarMenuToggleButton({
  isMobile,
  vibesIcon = false,
  extraMutedIdleIcon = false,
  resolvedStyle,
  tooltipSide = "right",
  testID = "menu-button",
  nativeID = "menu-button",
}: Omit<SidebarMenuToggleProps, "style" | "forceVisible"> & {
  isMobile: boolean;
  extraMutedIdleIcon?: boolean;
  resolvedStyle: StyleProp<ViewStyle>;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useMemo(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );

  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("shell.menu.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={resolvedStyle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
      accessibilityState={accessibilityState}
    >
      {isMobile || vibesIcon ? (
        <MobileMenuIcon
          color={
            extraMutedIdleIcon ? theme.colors.foregroundExtraMuted : theme.colors.foregroundMuted
          }
        />
      ) : (
        <PanelLeft
          size={iconButtonChromeGlyphSize("large")}
          strokeWidth={1.5}
          color={
            extraMutedIdleIcon ? theme.colors.foregroundExtraMuted : theme.colors.foregroundMuted
          }
        />
      )}
    </HeaderToggleButton>
  );
}

export function SidebarMenuToggle({
  style,
  forceVisible = false,
  ...props
}: SidebarMenuToggleProps = {}) {
  const isMobile = useIsCompactFormFactor();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const hasTopLeftWindowControls = useHasWindowChromeObstruction("top-left");
  const resolvedStyle = useMemo(() => [styles.leadingToggle, style], [style]);
  const placeholderStyle = useMemo(
    () => [headerIconSlotStyle.slot, resolvedStyle],
    [resolvedStyle],
  );

  if (!forceVisible && !isMobile && !ownsTopLeft) {
    return null;
  }

  if (!forceVisible && !isMobile && hasTopLeftWindowControls) {
    return (
      <View pointerEvents="none" style={placeholderStyle}>
        <View style={styles.desktopMenuIconSpace} />
      </View>
    );
  }

  return <SidebarMenuToggleButton {...props} isMobile={isMobile} resolvedStyle={resolvedStyle} />;
}

export function WindowSidebarMenuToggle({ style, ...props }: SidebarMenuToggleProps = {}) {
  const resolvedStyle = useMemo(() => [styles.leadingToggle, style], [style]);
  return (
    <SidebarMenuToggleButton
      {...props}
      isMobile={false}
      extraMutedIdleIcon
      resolvedStyle={resolvedStyle}
    />
  );
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  leadingToggle: {
    marginLeft: {
      xs: 0,
      md: -theme.spacing[2],
    },
  },
  left: {
    gap: theme.spacing[2],
  },
  mobileMenuIcon: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  desktopMenuIconSpace: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
  },
  mobileMenuLine: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: MOBILE_MENU_LINE_HEIGHT,
    borderRadius: theme.borderRadius.full,
  },
}));
