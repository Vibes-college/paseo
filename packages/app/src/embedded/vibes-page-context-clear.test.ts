import { beforeEach, describe, expect, it } from "vitest";
import { useDraftStore } from "@/stores/draft-store";

describe("VIBES page context logout cleanup", () => {
  beforeEach(() => {
    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
  });

  it("removes VIBES context from every persisted draft without deleting text or files", () => {
    const context = {
      kind: "vibes_page_context" as const,
      context: {
        version: "vibes-public-page-context/1" as const,
        epoch: 70,
        surface: "work_detail" as const,
        path: "/works/flappy-flight",
        entity: {
          kind: "work" as const,
          slug: "flappy-flight",
          title: "Flappy Flight",
          href: "/works/flappy-flight",
        },
      },
    };
    const store = useDraftStore.getState();
    store.saveDraftInput({
      draftKey: "agent:one",
      draft: { text: "保留问题", attachments: [context] },
    });
    store.saveDraftInput({
      draftKey: "agent:two",
      draft: {
        text: "保留另一个问题",
        attachments: [
          {
            kind: "workspace_file",
            path: "src/example.ts",
            selection: { kind: "whole_file" },
          },
          context,
        ],
      },
    });

    useDraftStore.getState().clearVibesPageContext();

    expect(useDraftStore.getState().getDraftInput("agent:one")).toEqual({
      text: "保留问题",
      attachments: [],
    });
    expect(useDraftStore.getState().getDraftInput("agent:two")).toEqual({
      text: "保留另一个问题",
      attachments: [
        {
          kind: "workspace_file",
          path: "src/example.ts",
          selection: { kind: "whole_file" },
        },
      ],
    });
  });
});
