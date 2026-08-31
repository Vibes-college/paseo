import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const relayPackageUrl = new URL("../", import.meta.url);
const repositoryUrl = new URL("../../../", import.meta.url);

async function readFromRelay(path: string): Promise<string> {
  return readFile(new URL(path, relayPackageUrl), "utf8");
}

async function readFromRepository(path: string): Promise<string> {
  return readFile(new URL(path, repositoryUrl), "utf8");
}

describe("Cloudflare Relay PoC deployment safety", () => {
  it("keeps the checked-in Worker disabled and detached from Production routing", async () => {
    const wrangler = await readFromRelay("wrangler.toml");

    expect(wrangler).toContain('name = "vibes-paseo-relay-do-poc"');
    expect(wrangler).toContain('PASEO_RELAY_POC_MODE = "disabled"');
    expect(wrangler).toContain("workers_dev = false");
    expect(wrangler).toContain("preview_urls = false");
    expect(wrangler).not.toMatch(
      /account_id|custom_domain|\broutes?\s*=|^\s*\[\[?routes?\]?\]|PASEO_RELAY_UPSTREAM/mu,
    );
    expect(wrangler).not.toContain("relay.paseo.sh");
  });

  it("runs only a Cloudflare dry run from the PoC workflow", async () => {
    const workflow = await readFromRepository(".github/workflows/relay-poc.yml");

    const deployInvocations = workflow
      .split("\n")
      .filter((line) => line.includes("wrangler") && line.includes("deploy"));
    expect(deployInvocations.length).toBeGreaterThan(0);
    for (const invocation of deployInvocations) expect(invocation).toContain("--dry-run");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
  });
});
