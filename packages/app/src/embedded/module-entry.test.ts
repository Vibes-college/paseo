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
});
