import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runRelayPocMatrix } from "./relay-poc-matrix.js";

interface CliOptions {
  target: string;
  baseUrl: string;
  runId: string;
  output?: string;
  fullFrameBoundary: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRelayPocMatrix(options);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(options.output, json, "utf8");
  }
  process.stdout.write(json);
  if (result.failed > 0) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current?.startsWith("--")) throw new Error(`Unexpected argument: ${current}`);
    const name = current.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(name);
      continue;
    }
    values.set(name, next);
    index += 1;
  }

  const target = values.get("target");
  const baseUrl = values.get("base-url");
  const runId = values.get("run-id");
  if (!target || !baseUrl || !runId) {
    throw new Error("Required: --target <name> --base-url <http-url> --run-id <id>");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:") {
    throw new Error("--base-url must use local http; Preview uses a separate authorized runner");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("--base-url must not contain credentials, query parameters, or fragments");
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("--base-url must use localhost or a loopback IP");
  }

  return {
    target,
    baseUrl: parsed.origin,
    runId,
    output: values.get("output"),
    fullFrameBoundary: flags.has("full-frame-boundary"),
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
