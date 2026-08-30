import type { mountPaseoApp } from "./mount";
import { mountPaseoApp as mount } from "./mount";

export const COMPLETE_PASEO_MODULE_VERSION = 1 as const;

export interface CompletePaseoModuleV1 {
  readonly version: typeof COMPLETE_PASEO_MODULE_VERSION;
  readonly mountPaseoApp: typeof mountPaseoApp;
}

declare global {
  interface Window {
    __paseoCompleteAppModuleV1?: CompletePaseoModuleV1;
  }
}

if (typeof window !== "undefined") {
  if (window.__paseoCompleteAppModuleV1) {
    throw new Error("the Complete Paseo App module is already installed");
  }
  window.__paseoCompleteAppModuleV1 = {
    version: COMPLETE_PASEO_MODULE_VERSION,
    mountPaseoApp: mount,
  };
  window.dispatchEvent(new Event("paseo-complete-app-module-ready"));
}
