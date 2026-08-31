import { describe, expect, it } from "vitest";
import type { DraftInput } from "@/stores/draft-store";
import { applyPaseoLauncherDraft } from "./launcher-draft";

describe("embedded Paseo Launcher draft", () => {
  it("replaces the focused Composer text without sending or dropping attachments", async () => {
    const draftKey = "agent:server-1:agent-1";
    const initial: DraftInput = {
      text: "尚未发送的旧草稿",
      attachments: [
        {
          kind: "workspace_file",
          path: "src/example.ts",
          selection: { kind: "whole_file" },
        },
      ],
    };
    let saved: DraftInput | null = null;
    const request = {
      id: 7,
      surface: "compact" as const,
      draft: "分析当前 VIBES 作品并给出三个改进建议",
    };

    const outcome = await applyPaseoLauncherDraft({
      request,
      draftKey,
      source: {
        getSnapshot: () => request,
        subscribe: () => () => undefined,
      },
      drafts: {
        hydrate: async () => initial,
        save: (savedDraftKey, draft) => {
          expect(savedDraftKey).toBe(draftKey);
          saved = draft;
        },
      },
    });

    expect(outcome).toBe("applied");
    expect(saved).toEqual({
      text: "分析当前 VIBES 作品并给出三个改进建议",
      attachments: initial.attachments,
    });
  });

  it("opens Paseo without changing Composer text when the Launcher draft is empty", async () => {
    const request = { id: 8, surface: "full" as const, draft: "" };
    let saveCount = 0;

    const outcome = await applyPaseoLauncherDraft({
      request,
      draftKey: "agent:server-1:agent-1",
      source: {
        getSnapshot: () => request,
        subscribe: () => () => undefined,
      },
      drafts: {
        hydrate: async () => ({ text: "保留当前草稿", attachments: [] }),
        save: () => {
          saveCount += 1;
        },
      },
    });

    expect(outcome).toBe("applied");
    expect(saveCount).toBe(0);
  });

  it("drops an old Launcher request when a newer draft arrives during hydration", async () => {
    const first = { id: 9, surface: "compact" as const, draft: "旧问题" };
    const latest = { id: 10, surface: "compact" as const, draft: "新问题" };
    let snapshot = first;
    let releaseHydration: () => void = () => undefined;
    const hydration = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    let saveCount = 0;

    const outcomePromise = applyPaseoLauncherDraft({
      request: first,
      draftKey: "agent:server-1:agent-1",
      source: {
        getSnapshot: () => snapshot,
        subscribe: () => () => undefined,
      },
      drafts: {
        hydrate: async () => {
          await hydration;
          return { text: "", attachments: [] };
        },
        save: () => {
          saveCount += 1;
        },
      },
    });

    snapshot = latest;
    releaseHydration();

    await expect(outcomePromise).resolves.toBe("stale");
    expect(saveCount).toBe(0);
  });
});
