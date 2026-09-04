import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { isWeb } from "@/constants/platform";

export type PaseoProductMode = "chat" | "build";

/**
 * Cross-platform Chat/Build navigation for the product header. Routing stays
 * with the caller; this component owns only tab semantics and activation.
 */
export function ChatBuildModeSwitch({
  mode,
  onChat,
  onBuild,
}: {
  mode: PaseoProductMode;
  onChat(): void;
  onBuild(): void;
}) {
  return (
    <View
      style={styles.modeSwitch}
      accessibilityRole="tablist"
      accessibilityLabel="Paseo mode"
      testID="paseo-product-mode-switch"
    >
      <ModeButton
        label="Chat"
        selected={mode === "chat"}
        onPress={onChat}
        testID="paseo-mode-chat"
      />
      <ModeButton
        label="Build"
        selected={mode === "build"}
        onPress={onBuild}
        testID="paseo-mode-build"
      />
    </View>
  );
}

function ModeButton({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  testID: string;
}) {
  const style = useMemo(
    () =>
      ({ focused = false }: PressableStateCallbackType & { focused?: boolean }) => [
        styles.modeButton,
        focused && styles.modeButtonFocused,
      ],
    [],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const handleKeyDown = useCallback(
    (event: { key: string; preventDefault(): void }) => {
      if (event.key !== " " && event.key !== "Space" && event.key !== "Spacebar") return;
      event.preventDefault();
      onPress();
    },
    [onPress],
  );
  const webKeyboardProps = useMemo(
    () => (isWeb ? { onKeyDown: handleKeyDown } : {}),
    [handleKeyDown],
  );

  return (
    <Pressable
      {...webKeyboardProps}
      style={style}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      aria-selected={selected}
      testID={testID}
    >
      {({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
        <View style={styles.modeButtonContent} pointerEvents="none">
          <Text
            style={[
              styles.modeLabel,
              (hovered || pressed) && styles.modeLabelActive,
              selected && styles.modeLabelSelected,
            ]}
          >
            {label}
          </Text>
          {selected ? <View style={styles.modeIndicator} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  modeSwitch: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4] + theme.spacing[1],
  },
  modeButton: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    outlineWidth: 0,
    outlineColor: "transparent",
  },
  modeButtonFocused: {
    outlineWidth: theme.borderWidth[2],
    outlineColor: theme.colors.ring,
    borderRadius: theme.borderRadius.sm,
  },
  modeButtonContent: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[0.5],
  },
  modeIndicator: {
    position: "absolute",
    right: theme.spacing[0.5],
    bottom: 0,
    left: theme.spacing[0.5],
    height: theme.borderWidth[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foreground,
  },
  modeLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
  modeLabelActive: {
    color: theme.colors.foreground,
  },
  modeLabelSelected: {
    color: theme.colors.foreground,
  },
}));
