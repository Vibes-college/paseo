export function resolveRetainedScrollTop(input: {
  scrollHeight: number;
  clientHeight: number;
  bottomOffset: number;
}): number {
  return Math.max(0, input.scrollHeight - input.clientHeight - input.bottomOffset);
}

export function clampSelectionRange(input: { valueLength: number; start: number; end: number }): {
  start: number;
  end: number;
} {
  const start = Math.max(0, Math.min(input.start, input.valueLength));
  return {
    start,
    end: Math.max(start, Math.min(input.end, input.valueLength)),
  };
}
