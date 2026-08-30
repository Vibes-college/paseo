import { isWeb } from "@/constants/platform";
import { stripHostWorkspaceRouteEchoSearch } from "@/utils/host-routes";
import { isEmbeddedPaseoApp } from "@/embedded/mount-environment";

function getCurrentBrowserRoute(): string | null {
  if (!isWeb || typeof window === "undefined" || isEmbeddedPaseoApp()) {
    return null;
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function replaceBrowserRouteWithCanonicalHostWorkspaceRoute(route: string): void {
  if (!isWeb || typeof window === "undefined" || isEmbeddedPaseoApp()) {
    return;
  }
  window.history.replaceState(null, "", stripHostWorkspaceRouteEchoSearch(route));
}

export function stripHostWorkspaceRouteEchoSearchFromBrowserUrl(): void {
  const currentRoute = getCurrentBrowserRoute();
  if (!currentRoute) {
    return;
  }
  const canonicalRoute = stripHostWorkspaceRouteEchoSearch(currentRoute);
  if (canonicalRoute === currentRoute) {
    return;
  }
  window.history.replaceState(null, "", canonicalRoute);
}

export function stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit(): void {
  if (!isWeb || typeof window === "undefined" || isEmbeddedPaseoApp()) {
    return;
  }
  window.setTimeout(stripHostWorkspaceRouteEchoSearchFromBrowserUrl, 0);
}
