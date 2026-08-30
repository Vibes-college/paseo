import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { ChevronDown, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Theme } from "@/styles/theme";
import { usePaseoMountEnvironment, usePaseoMountSnapshot } from "@/embedded/mount-environment";
import { PaseoShellPortal } from "@/embedded/paseo-shell-portal";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface PaseoCompactShellControlsProps {
  tabs: WorkspaceTabDescriptor[];
  activeTab: WorkspaceTabDescriptor | null;
  activeTabKey: string;
  serverId: string;
  workspaceId: string;
  onCreateRuntime(): void;
  onSelectRuntime(key: string): void;
}

export function PaseoCompactShellControls({
  tabs,
  activeTab,
  activeTabKey,
  serverId,
  workspaceId,
  onCreateRuntime,
  onSelectRuntime,
}: PaseoCompactShellControlsProps) {
  const controller = usePaseoMountEnvironment();
  const mountSnapshot = usePaseoMountSnapshot();
  const slots = controller?.shellSlots;
  if (!controller || mountSnapshot?.surface !== "compact" || !slots) return null;

  return (
    <>
      <PaseoShellPortal slot={slots.newRuntime}>
        <HeaderToggleButton
          testID="paseo-compact-new-runtime"
          onPress={onCreateRuntime}
          tooltipLabel="New tab"
          tooltipKeys={[]}
          tooltipSide="bottom"
          style={styles.newRuntimeButton}
          accessible
          accessibilityRole="button"
          accessibilityLabel="New tab"
        >
          <ThemedPlus size={16} uniProps={mutedColorMapping} />
        </HeaderToggleButton>
      </PaseoShellPortal>
      <PaseoShellPortal slot={slots.runtimeMenu}>
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="paseo-compact-runtime-menu-trigger"
            style={runtimeTriggerStyle}
            accessibilityRole="button"
            accessibilityLabel={`Runtime menu, ${tabs.length} tabs`}
          >
            <View style={styles.runtimeTriggerLeft}>
              <ActiveRuntimeTitle tab={activeTab} serverId={serverId} workspaceId={workspaceId} />
            </View>
            <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width={300} testID="paseo-compact-runtime-menu">
            {tabs.map((tab) => (
              <RuntimeMenuItem
                key={tab.key}
                tab={tab}
                selected={tab.key === activeTabKey}
                serverId={serverId}
                workspaceId={workspaceId}
                onSelect={onSelectRuntime}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </PaseoShellPortal>
      {activeTab ? (
        <WorkspaceTabPresentationResolver
          tab={activeTab}
          serverId={serverId}
          workspaceId={workspaceId}
        >
          {(presentation) => <PaseoShellPresentationEffect presentation={presentation} />}
        </WorkspaceTabPresentationResolver>
      ) : null}
    </>
  );
}

function ActiveRuntimeTitle({
  tab,
  serverId,
  workspaceId,
}: {
  tab: WorkspaceTabDescriptor | null;
  serverId: string;
  workspaceId: string;
}) {
  if (!tab) return null;
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <>
          <View style={styles.runtimeIcon}>
            <WorkspaceTabIcon presentation={presentation} active backdrop="surface0" />
          </View>
          <Text style={styles.runtimeTitle} numberOfLines={1}>
            {presentation.titleState === "loading" ? "Loading Runtime…" : presentation.label}
          </Text>
        </>
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function RuntimeMenuItem({
  tab,
  selected,
  serverId,
  workspaceId,
  onSelect,
}: {
  tab: WorkspaceTabDescriptor;
  selected: boolean;
  serverId: string;
  workspaceId: string;
  onSelect(key: string): void;
}) {
  const selectTab = useCallback(() => onSelect(tab.key), [onSelect, tab.key]);
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <RuntimeMenuItemContent
          presentation={presentation}
          selected={selected}
          onSelect={selectTab}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function RuntimeMenuItemContent({
  presentation,
  selected,
  onSelect,
}: {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  onSelect(): void;
}) {
  const leading = useMemo(
    () => <WorkspaceTabIcon presentation={presentation} active backdrop="surface0" />,
    [presentation],
  );
  return (
    <DropdownMenuItem selected={selected} leading={leading} onSelect={onSelect}>
      {presentation.titleState === "loading" ? "Loading Runtime…" : presentation.label}
    </DropdownMenuItem>
  );
}

function PaseoShellPresentationEffect({
  presentation,
}: {
  presentation: WorkspaceTabPresentation;
}) {
  const controller = usePaseoMountEnvironment();
  useEffect(() => {
    if (!controller) return;
    controller.callbacks.shellPresentationChanged({
      title: presentation.titleState === "loading" ? "Loading Runtime…" : presentation.label,
      state: resolveShellState(presentation.statusBucket),
    });
  }, [controller, presentation.label, presentation.statusBucket, presentation.titleState]);
  return null;
}

function resolveShellState(
  bucket: WorkspaceTabPresentation["statusBucket"],
): "idle" | "running" | "attention" {
  if (bucket === "running") return "running";
  if (bucket === "failed" || bucket === "attention" || bucket === "needs_input") {
    return "attention";
  }
  return "idle";
}

function runtimeTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return [styles.runtimeTrigger, (hovered || pressed || open) && styles.runtimeTriggerActive];
}

const styles = StyleSheet.create((theme) => ({
  newRuntimeButton: {
    width: 32,
    height: 32,
  },
  runtimeTrigger: {
    height: 32,
    maxWidth: 250,
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  runtimeTriggerActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  runtimeTriggerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  runtimeIcon: {
    flexShrink: 0,
  },
  runtimeTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
