import type { DraftInput } from "@/stores/draft-store";
import type { PaseoSurface } from "./mount-environment";
import { vibesPageContextSchema, type VibesPageContext } from "./vibes-page-context";

export interface PaseoLaunchRequest {
  id: number;
  surface: PaseoSurface;
  draft: string;
  pageContext: VibesPageContext;
}

export interface PaseoLaunchSource {
  getSnapshot(): PaseoLaunchRequest | null;
  subscribe(listener: () => void): () => void;
}

const appliedLaunchRequests = new WeakSet<PaseoLaunchRequest>();

export function isPaseoLaunchRequestApplied(request: PaseoLaunchRequest): boolean {
  return appliedLaunchRequests.has(request);
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
}): Promise<"already_applied" | "applied" | "stale"> {
  if (isPaseoLaunchRequestApplied(input.request)) return "already_applied";
  if (!input.request.draft) {
    appliedLaunchRequests.add(input.request);
    return "applied";
  }

  const draft = await input.drafts.hydrate(input.draftKey);
  if (input.source.getSnapshot()?.id !== input.request.id) return "stale";

  const attachments: DraftInput["attachments"] = (draft?.attachments ?? []).filter(
    (attachment) => attachment.kind !== "vibes_page_context",
  );
  const pageContext = vibesPageContextSchema.safeParse(input.request.pageContext);
  if (pageContext.success && !("state" in pageContext.data)) {
    attachments.push({
      kind: "vibes_page_context",
      context: pageContext.data,
    });
  }
  input.drafts.save(input.draftKey, {
    text: input.request.draft,
    attachments,
  });
  appliedLaunchRequests.add(input.request);
  return "applied";
}
