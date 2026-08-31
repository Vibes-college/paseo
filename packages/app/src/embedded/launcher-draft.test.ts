import { describe, expect, it } from "vitest";
import type { DraftInput } from "@/stores/draft-store";
import { applyPaseoLauncherDraft } from "./launcher-draft";

const unavailablePageContext = {
  version: "vibes-public-page-context/1" as const,
  epoch: 0,
  state: "unavailable" as const,
  reason: "unsupported" as const,
};

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
      pageContext: unavailablePageContext,
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
    const request = {
      id: 8,
      surface: "full" as const,
      draft: "",
      pageContext: unavailablePageContext,
    };
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
    const first = {
      id: 9,
      surface: "compact" as const,
      draft: "旧问题",
      pageContext: unavailablePageContext,
    };
    const latest = {
      id: 10,
      surface: "compact" as const,
      draft: "新问题",
      pageContext: unavailablePageContext,
    };
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

  it("replaces only the VIBES page attachment with the current launch snapshot", async () => {
    const previousContext = {
      version: "vibes-public-page-context/1" as const,
      epoch: 60,
      surface: "event_catalog" as const,
      path: "/event" as const,
    };
    const pageContext = {
      version: "vibes-public-page-context/1" as const,
      epoch: 61,
      surface: "work_detail" as const,
      path: "/works/flappy-flight",
      entity: {
        kind: "work" as const,
        slug: "flappy-flight",
        title: "Flappy Flight",
        href: "/works/flappy-flight",
      },
    };
    const request = {
      id: 11,
      surface: "compact" as const,
      draft: "解释当前作品",
      pageContext,
    };
    let saved: DraftInput | null = null;

    await applyPaseoLauncherDraft({
      request,
      draftKey: "agent:server-1:agent-1",
      source: {
        getSnapshot: () => request,
        subscribe: () => () => undefined,
      },
      drafts: {
        hydrate: async () => ({
          text: "旧问题",
          attachments: [
            {
              kind: "workspace_file",
              path: "src/example.ts",
              selection: { kind: "whole_file" },
            },
            { kind: "vibes_page_context", context: previousContext },
          ],
        }),
        save: (_draftKey, draft) => {
          saved = draft;
        },
      },
    });

    expect(saved).toEqual({
      text: "解释当前作品",
      attachments: [
        {
          kind: "workspace_file",
          path: "src/example.ts",
          selection: { kind: "whole_file" },
        },
        { kind: "vibes_page_context", context: pageContext },
      ],
    });
  });

  it("clears a previous VIBES chip when the launch context is unavailable", async () => {
    const request = {
      id: 12,
      surface: "compact" as const,
      draft: "不要携带私有页面",
      pageContext: {
        version: "vibes-public-page-context/1" as const,
        epoch: 63,
        state: "unavailable" as const,
        reason: "private" as const,
      },
    };
    let saved: DraftInput | null = null;

    await applyPaseoLauncherDraft({
      request,
      draftKey: "agent:server-1:agent-1",
      source: {
        getSnapshot: () => request,
        subscribe: () => () => undefined,
      },
      drafts: {
        hydrate: async () => ({
          text: "旧问题",
          attachments: [
            {
              kind: "vibes_page_context",
              context: {
                version: "vibes-public-page-context/1",
                epoch: 62,
                surface: "work_catalog",
                path: "/games",
                filters: { workType: "game" },
              },
            },
          ],
        }),
        save: (_draftKey, draft) => {
          saved = draft;
        },
      },
    });

    expect(saved).toEqual({
      text: "不要携带私有页面",
      attachments: [],
    });
  });

  it("does not reapply one launch request after the Composer remounts", async () => {
    const request = {
      id: 13,
      surface: "compact" as const,
      draft: "只应用一次",
      pageContext: unavailablePageContext,
    };
    const source = {
      getSnapshot: () => request,
      subscribe: () => () => undefined,
    };
    let saveCount = 0;
    const drafts = {
      hydrate: async () => ({ text: "", attachments: [] }),
      save: () => {
        saveCount += 1;
      },
    };

    await expect(
      applyPaseoLauncherDraft({
        request,
        draftKey: "agent:server-1:agent-1",
        source,
        drafts,
      }),
    ).resolves.toBe("applied");
    await expect(
      applyPaseoLauncherDraft({
        request,
        draftKey: "agent:server-1:agent-1",
        source,
        drafts,
      }),
    ).resolves.toBe("already_applied");
    expect(saveCount).toBe(1);
  });
});
