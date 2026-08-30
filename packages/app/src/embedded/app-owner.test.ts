import { describe, expect, it } from "vitest";
import { createPaseoAppOwner, getPaseoAppOwnerDiagnostics } from "./app-owner";

describe("Paseo application owner", () => {
  it("rejects concurrent owners and supports clean remount", async () => {
    const first = createPaseoAppOwner();
    expect(first.diagnostics()).toMatchObject({ installed: true, disposed: false });
    expect(() => createPaseoAppOwner()).toThrow("a Paseo application owner is already installed");

    await first.dispose();
    await first.dispose();
    expect(getPaseoAppOwnerDiagnostics()).toBeNull();

    const second = createPaseoAppOwner();
    expect(second.generation).toBeGreaterThan(first.generation);
    await second.dispose();
  });
});
