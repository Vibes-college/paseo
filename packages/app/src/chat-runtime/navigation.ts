import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";

import { buildHostChatAgentRoute, buildHostChatRoute } from "@/utils/host-routes";
import {
  createChatRouteSelectionStore,
  type ChatRouteSelectionStorage,
  type ChatRouteTarget,
} from "./chat-route-selection";

/**
 * Adapts browser-local Chat route memory to Expo Router. It never touches Build
 * workspace selection, so changing product modes preserves both route owners.
 */

export const CHAT_ROUTE_SELECTION_STORAGE_KEY = "paseo:chat-route-selection:v1";

const storage: ChatRouteSelectionStorage = {
  read: () => AsyncStorage.getItem(CHAT_ROUTE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(CHAT_ROUTE_SELECTION_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(CHAT_ROUTE_SELECTION_STORAGE_KEY),
};
const routeSelections = createChatRouteSelectionStore(storage);

export function hydrateChatRouteSelections(): Promise<void> {
  return routeSelections.hydrate();
}

export function rememberChatRoute(serverId: string, target: ChatRouteTarget): void {
  routeSelections.remember({ serverId, target });
}

export function navigateToChatDraft(serverId: string): void {
  rememberChatRoute(serverId, { kind: "draft" });
  router.navigate(buildHostChatRoute(serverId));
}

export function navigateToChatAgent(serverId: string, agentId: string): void {
  rememberChatRoute(serverId, { kind: "agent", agentId });
  router.navigate(buildHostChatAgentRoute(serverId, agentId));
}

export function navigateToRememberedChat(serverId: string): void {
  const target = routeSelections.get(serverId);
  if (target?.kind === "agent") {
    router.navigate(buildHostChatAgentRoute(serverId, target.agentId));
    return;
  }
  router.navigate(buildHostChatRoute(serverId));
}

export function useRememberChatRoute(serverId: string, target: ChatRouteTarget): void {
  useEffect(() => {
    rememberChatRoute(serverId, target);
  }, [serverId, target]);
}

export function useLastChatRoute(serverId: string): ChatRouteTarget | null {
  return useSyncExternalStore(
    routeSelections.subscribe,
    () => routeSelections.get(serverId),
    () => routeSelections.get(serverId),
  );
}

void hydrateChatRouteSelections();
