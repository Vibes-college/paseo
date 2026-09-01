import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Complete Paseo embedded module entry", () => {
  it("exports one opaque mount API without mounting a Host root", async () => {
    const source = await readSource("./module-entry.ts");
    expect(source).toContain("__paseoCompleteAppModuleV1");
    expect(source).toContain("mountPaseoApp: mount");
    expect(source).not.toMatch(/querySelector|createElement|AppRegistry\.runApplication/);
    expect(source).not.toMatch(/serverId|workspaceId|agentId|credential/);
  });

  it("gates the mount harness to explicit builds or E2E paseoPath requests", async () => {
    const [entry, globalSetup] = await Promise.all([
      readSource("../../index.ts"),
      readSource("../../e2e/support/global-setup.ts"),
    ]);
    expect(entry).toContain('process.env.EXPO_PUBLIC_COMPLETE_ROOT_MOUNT === "true"');
    expect(entry).toContain('process.env.EXPO_PUBLIC_E2E === "true"');
    expect(entry).toContain('new URLSearchParams(window.location.search).has("paseoPath")');
    expect(globalSetup).toContain('EXPO_PUBLIC_E2E: "true"');
  });

  it("installs the Expo Router no-linking patch after every clean install", async () => {
    const [postinstall, patch] = await Promise.all([
      readSource("../../../../scripts/postinstall-patches.mjs"),
      readSource("../../../../patches/expo-router+6.0.23.patch"),
    ]);
    expect(postinstall).toContain('nodeModulesPath: "node_modules/expo-router"');
    expect(postinstall).toContain('patchPrefix: "expo-router+"');
    expect(patch).toContain("enabled: false");
  });

  it("builds Production modules at the admitted VIBES asset path", async () => {
    const [config, packageJson] = await Promise.all([
      readSource("../../app.config.js"),
      readSource("../../package.json"),
    ]);
    expect(config).toContain("EXPO_PUBLIC_COMPLETE_ROOT_BASE_URL");
    expect(config).toContain("baseUrl: completeRootModuleBaseUrl");
    expect(config).toContain("/__paseo_development__");
    expect(packageJson).toContain('"build:web:embedded-module:production"');
    expect(packageJson).toContain("/vendor/paseo/complete-root-v1");
  });
});
