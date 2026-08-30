import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function PaseoShellPortal({ slot, children }: { slot: HTMLElement; children: ReactNode }) {
  return createPortal(children, slot);
}
