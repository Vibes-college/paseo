import type { DraftInput } from "@/stores/draft-store";
import type { PaseoSurface } from "./mount-environment";

export interface PaseoLaunchRequest {
  id: number;
  surface: PaseoSurface;
  draft: string;
}

export interface PaseoLaunchSource {
  getSnapshot(): PaseoLaunchRequest | null;
  subscribe(listener: () => void): () => void;
}

interface PaseoLauncherDraftPort {
  hydrate(draftKey: string): Promise<DraftInput | undefined>;
  save(draftKey: string, draft: DraftInput): void;
}

export async function applyPaseoLauncherDraft(input: {
  request: PaseoLaunchRequest;
  draftKey: string;
  source: PaseoLaunchSource;
  drafts: PaseoLauncherDraftPort;
}): Promise<"applied" | "stale"> {
  if (!input.request.draft) return "applied";

  const draft = await input.drafts.hydrate(input.draftKey);
  if (input.source.getSnapshot()?.id !== input.request.id) return "stale";

  input.drafts.save(input.draftKey, {
    text: input.request.draft,
    attachments: draft?.attachments ?? [],
  });
  return "applied";
}
