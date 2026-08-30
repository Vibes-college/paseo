import { clampSelectionRange, resolveRetainedScrollTop } from "./surface-retention-policy";

export interface PaseoSurfaceRetentionSnapshot {
  selection: {
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null;
  timelineBottomOffset: number | null;
}

export interface PaseoSurfaceRetentionRestore {
  selectionRestored: boolean;
  timelineRestored: boolean;
  timelineScrollTop: number | null;
}

export function capturePaseoSurfaceRetention(): PaseoSurfaceRetentionSnapshot {
  const textarea = findVisible<HTMLTextAreaElement>("textarea");
  const timeline = findVisible<HTMLElement>('[data-testid="agent-chat-scroll"]');
  return {
    selection: textarea
      ? {
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
          direction: textarea.selectionDirection,
        }
      : null,
    timelineBottomOffset: timeline
      ? timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop
      : null,
  };
}

export async function restorePaseoSurfaceRetention(
  snapshot: PaseoSurfaceRetentionSnapshot,
): Promise<PaseoSurfaceRetentionRestore> {
  let selectionRestored = false;
  let timelineRestored = false;
  let timelineScrollTop: number | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt < 3) {
      await nextFrame();
    } else {
      await delay((attempt - 2) * 100);
    }
    const textarea = findVisible<HTMLTextAreaElement>("textarea");
    if (textarea && snapshot.selection) {
      const range = clampSelectionRange({
        valueLength: textarea.value.length,
        start: snapshot.selection.start,
        end: snapshot.selection.end,
      });
      textarea.setSelectionRange(range.start, range.end, snapshot.selection.direction);
      selectionRestored = true;
    }

    const timeline = findVisible<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (timeline && snapshot.timelineBottomOffset !== null) {
      timeline.scrollTop = resolveRetainedScrollTop({
        scrollHeight: timeline.scrollHeight,
        clientHeight: timeline.clientHeight,
        bottomOffset: snapshot.timelineBottomOffset,
      });
      timelineScrollTop = timeline.scrollTop;
      timelineRestored = true;
    }
  }

  return { selectionRestored, timelineRestored, timelineScrollTop };
}

function findVisible<T extends HTMLElement>(selector: string): T | null {
  for (const element of document.querySelectorAll<T>(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
