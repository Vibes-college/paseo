import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("embedded surface actions", () => {
  it("keeps the unified header close action surface-aware", async () => {
    const headerSource = await readSource("../components/headers/paseo-product-header.tsx");

    expect(headerSource).toContain('mountSnapshot?.surface === "full"');
    expect(headerSource).toContain('requestSurface("compact")');
    expect(headerSource).toContain("requestMinimize()");
    expect(headerSource).toContain('accessibilityLabel="Close Paseo"');
  });

  it("gives Compact direct New chat and Open full controls without deep-action menus", async () => {
    const headerSource = await readSource("../components/headers/paseo-product-header.tsx");
    const menuSource = await readSource("../screens/workspace/workspace-header-menu.tsx");
    const navigationSource = await readSource("../chat-runtime/navigation.ts");

    expect(headerSource).toContain('mountSnapshot?.surface === "compact"');
    expect(headerSource).toContain("navigateToChatDraft(serverId)");
    expect(headerSource).toContain('testID="paseo-new-chat"');
    expect(headerSource).toContain('accessibilityLabel="New chat"');
    expect(headerSource).toContain('requestSurface("full")');
    expect(headerSource).toContain('testID="paseo-open-full"');
    expect(headerSource).toContain('accessibilityLabel="Open full Paseo"');
    expect(headerSource).toContain("isCompactSurface ? compactLeft : fullLeft");
    expect(headerSource).toContain("isCompactSurface ? compactRight : fullRight");
    expect(menuSource).not.toContain("PaseoOpenFullMenuItem");
    expect(navigationSource).toContain("const target = routeSelections.get(serverId)");
    expect(navigationSource).not.toContain("await hydrateChatRouteSelections()");
  });

  it("gives the standalone Compact shell the unified product header slot", async () => {
    const shellSource = await readSource("./compact-host-shell.web.ts");

    expect(shellSource).toContain("productHeader: HTMLElement");
    expect(shellSource).toContain('createSlot("product-header")');
    expect(shellSource).toContain("header.append(productHeader, newRuntime, runtimeMenu");
    expect(shellSource).toContain("slots: { productHeader, newRuntime, runtimeMenu }");
    expect(shellSource).toContain(':not([data-slot="product-header"])');
    expect(shellSource).toContain("#paseo-open-full");
    expect(shellSource).toContain("productOpenFull ?? fullButton");
  });
});
