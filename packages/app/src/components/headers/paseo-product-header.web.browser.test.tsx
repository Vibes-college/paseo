import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatBuildModeSwitch, type PaseoProductMode } from "@/components/headers/paseo-mode-switch";

interface MountedModeSwitch {
  container: HTMLDivElement;
  root: Root;
}

const mountedSwitches: MountedModeSwitch[] = [];

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

function ModeSwitchHarness() {
  const [mode, setMode] = useState<PaseoProductMode>("chat");
  const onChat = useCallback(() => setMode("chat"), []);
  const onBuild = useCallback(() => setMode("build"), []);
  return <ChatBuildModeSwitch mode={mode} onChat={onChat} onBuild={onBuild} />;
}

function mountModeSwitch(): MountedModeSwitch {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ModeSwitchHarness />));

  const mounted = { container, root };
  mountedSwitches.push(mounted);
  return mounted;
}

function getModeTab(container: HTMLElement, label: string): HTMLElement {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  if (!tab) throw new Error(`${label} mode tab did not render`);
  return tab;
}

afterEach(() => {
  for (const mounted of mountedSwitches.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
  vi.unstubAllGlobals();
});

describe("ChatBuildModeSwitch on web", () => {
  it("activates the focused Build tab with Space", () => {
    const { container } = mountModeSwitch();
    const chat = getModeTab(container, "Chat");
    const build = getModeTab(container, "Build");

    expect(chat.tagName).toBe("DIV");
    expect(chat.getAttribute("aria-selected")).toBe("true");
    expect(build.getAttribute("aria-selected")).toBe("false");

    build.focus();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
    });
    act(() => build.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(chat.getAttribute("aria-selected")).toBe("false");
    expect(build.getAttribute("aria-selected")).toBe("true");
  });
});
