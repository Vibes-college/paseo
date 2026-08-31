import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { buildRelayWebSocketUrl, parseHostPort } from "@getpaseo/protocol/daemon-endpoints";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { generateLocalPairingOffer } from "../pairing-offer.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface CliOptions {
  target: string;
  endpoint: string;
  output?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const logger = pino({ level: "silent" });
  const daemon = await createTestPaseoDaemon({
    listen: "127.0.0.1",
    relayEnabled: true,
    relayEndpoint: options.endpoint,
    relayUseTls: false,
    logger,
  });
  let client: DaemonClient | null = null;

  try {
    const pairing = await generateLocalPairingOffer({
      paseoHome: daemon.paseoHome,
      relayEnabled: true,
      relayEndpoint: options.endpoint,
      relayPublicEndpoint: options.endpoint,
      relayUseTls: false,
      relayPublicUseTls: false,
      includeQr: false,
    });
    if (!pairing.url) throw new Error("Pairing did not return an isolated Relay offer");
    const offer = parseConnectionOfferFromUrl(pairing.url);
    if (!offer) throw new Error("Could not parse the isolated Relay offer");

    client = new DaemonClient({
      url: buildRelayWebSocketUrl({
        endpoint: options.endpoint,
        useTls: false,
        serverId: offer.serverId,
        role: "client",
      }),
      clientId: `clid_vibes_relay_poc_${options.target.replace(/[^a-zA-Z0-9_-]/gu, "_")}`,
      clientType: "cli",
      appVersion: "0.7.0-beta.1",
      connectTimeoutMs: 30_000,
      e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      reconnect: { enabled: false },
    });
    await client.connect();
    const agents = await client.fetchAgents();
    const ping = await client.ping({ timeoutMs: 10_000 });

    const result = {
      schema: "vibes-relay-isolated-daemon-poc/1",
      target: options.target,
      endpoint: options.endpoint,
      startedAt,
      finishedAt: new Date().toISOString(),
      daemon: {
        isolatedPaseoHome: true,
        listenPort: daemon.port,
        mainDaemonPort: 6767,
      },
      journey: {
        pairingOffer: "generated-in-memory",
        e2ee: "established",
        serverInfo: "received",
        fetchAgents: "completed",
        initialAgentCount: agents.entries.length,
        ping: "completed",
        pingRttMs: ping.rttMs,
      },
      status: "passed",
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await writeFile(options.output, json, "utf8");
    }
    process.stdout.write(json);
  } finally {
    await client?.close().catch(() => undefined);
    await daemon.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("Arguments must be --name value pairs");
    values.set(name.slice(2), value);
  }
  const target = values.get("target");
  const endpoint = values.get("endpoint");
  if (!target || !endpoint) throw new Error("Required: --target <name> --endpoint <host:port>");
  const parsedEndpoint = parseHostPort(endpoint);
  if (parsedEndpoint.port === 6767)
    throw new Error("Port 6767 is outside the isolated PoC boundary");
  if (!isLoopbackHost(parsedEndpoint.host)) {
    throw new Error("--endpoint must use localhost or a loopback IP");
  }
  return { target, endpoint, output: values.get("output") };
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
