import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import {
  navigateToLastWorkspace,
  useActiveWorkspaceSelection,
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { usePaseoLaunchRequest } from "./mount-environment";

type KeyboardActionDispatcher = ReturnType<typeof useKeyboardActionDispatcher>;

// Compact chrome stabilizes its Full control across two frames before Composer takes focus.
function focusComposerAfterChrome(dispatcher: KeyboardActionDispatcher): void {
  let framesRemaining = 3;
  function advance() {
    framesRemaining -= 1;
    if (framesRemaining > 0) {
      requestAnimationFrame(advance);
      return;
    }
    dispatcher.dispatch({
      id: "message-input.focus",
      scope: "message-input",
    });
  }
  requestAnimationFrame(advance);
}

export function PaseoLauncherDraftBridge() {
  const request = usePaseoLaunchRequest();
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useLocalSearchParams<{ draftId?: string | string[] }>();
  const routeDraftId = typeof routeParams.draftId === "string" ? routeParams.draftId : undefined;
  const newWorkspaceDraftKey = pathname === "/new" ? buildNewWorkspaceDraftKey(routeDraftId) : null;
  const activeWorkspace = useActiveWorkspaceSelection();
  const lastWorkspace = useLastWorkspaceSelection();
  const isLastWorkspaceHydrated = useIsLastWorkspaceSelectionHydrated();
  const isLayoutHydrated = useWorkspaceLayoutStoreHydrated();
  const keyboardActions = useKeyboardActionDispatcher();
  const workspaceKey = useMemo(
    () => (activeWorkspace ? buildWorkspaceTabPersistenceKey(activeWorkspace) : null),
    [activeWorkspace],
  );
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const openTab = useWorkspaceLayoutStore((state) => state.openTab);
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const appliedRequestIdRef = useRef(0);
  const navigationRequestIdRef = useRef(0);
  const draftTabRequestIdRef = useRef(0);

  useEffect(() => {
    if (!request || request.id <= appliedRequestIdRef.current) return;
    if (!request.draft) {
      appliedRequestIdRef.current = request.id;
      return;
    }
    if (newWorkspaceDraftKey) {
      appliedRequestIdRef.current = request.id;
      focusComposerAfterChrome(keyboardActions);
      return;
    }
    if (!activeWorkspace || !workspaceKey) {
      if (!isLastWorkspaceHydrated || navigationRequestIdRef.current === request.id) {
        return;
      }
      navigationRequestIdRef.current = request.id;
      if (!lastWorkspace || !navigateToLastWorkspace()) {
        router.push("/new" as Href);
      }
      return;
    }
    if (!isLayoutHydrated || !layout) return;

    const target = resolveFocusedChatTarget({
      serverId: activeWorkspace.serverId,
      layout,
    });
    if (!target) {
      if (draftTabRequestIdRef.current === request.id) return;
      const tabId = openTab({
        workspaceKey,
        target: { kind: "draft", draftId: generateDraftId() },
        intent: "new",
      });
      if (tabId) draftTabRequestIdRef.current = request.id;
      return;
    }

    focusTab(workspaceKey, target.tabId);
    appliedRequestIdRef.current = request.id;
    focusComposerAfterChrome(keyboardActions);
  }, [
    activeWorkspace,
    focusTab,
    isLastWorkspaceHydrated,
    isLayoutHydrated,
    keyboardActions,
    lastWorkspace,
    layout,
    newWorkspaceDraftKey,
    openTab,
    request,
    router,
    workspaceKey,
  ]);

  return null;
}
