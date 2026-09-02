import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

test("two clients resolve one durable Chat workspace without exposing it in Build lists", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const firstClient = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.7.0",
  });
  const secondClient = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.7.0",
  });

  try {
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    expect(firstClient.getLastServerInfoMessage()?.features?.chatWorkspace).toBe(true);
    const projectUpdates: unknown[] = [];
    const workspaceUpdates: unknown[] = [];
    const agentUpdates: unknown[] = [];
    firstClient.on("project.update", (message) => projectUpdates.push(message));
    firstClient.on("workspace_update", (message) => workspaceUpdates.push(message));
    firstClient.on("agent_update", (message) => agentUpdates.push(message));
    await Promise.all([
      firstClient.listProjects({ sync: {} }),
      firstClient.fetchWorkspaces({ subscribe: { subscriptionId: "hidden-chat-e2e" } }),
      firstClient.fetchAgents({ subscribe: { subscriptionId: "hidden-chat-build-agents" } }),
    ]);

    const [first, second] = await Promise.all([
      firstClient.resolveChatWorkspace("resolve-chat-first"),
      secondClient.resolveChatWorkspace("resolve-chat-second"),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.workspace).toEqual(first.workspace);
    expect(first.workspace?.cwd).toBe(path.join(daemon.paseoHome, "runtime", "chat-workspace"));
    expect(projectUpdates).toEqual([]);
    expect(workspaceUpdates).toEqual([]);
    if (!first.workspace) throw new Error("Chat workspace was not resolved");

    const chatAgent = await firstClient.createAgent({
      requestId: "create-hidden-chat-agent",
      provider: "codex",
      cwd: first.workspace.cwd,
      workspaceId: first.workspace.workspaceId,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(agentUpdates).toEqual([]);
    expect(workspaceUpdates).toEqual([]);

    const [buildHistory, chatHistory] = await Promise.all([
      firstClient.fetchAgentHistory({ page: { limit: 25 } }),
      firstClient.fetchAgentHistory({
        filter: { workspaceIds: [first.workspace.workspaceId] },
        page: { limit: 25 },
      }),
    ]);
    expect(buildHistory.entries.map((entry) => entry.agent.id)).not.toContain(chatAgent.id);
    expect(chatHistory.entries.map((entry) => entry.agent.id)).toEqual([chatAgent.id]);

    const [workspaces, projects] = await Promise.all([
      firstClient.fetchWorkspaces(),
      firstClient.listProjects(),
    ]);
    expect(workspaces.entries).toEqual([]);
    expect(workspaces.emptyProjects).toEqual([]);
    expect(projects.projects).toEqual([]);

    const persistedProjects = JSON.parse(
      await readFile(path.join(daemon.paseoHome, "projects", "projects.json"), "utf8"),
    ) as Array<{ internalPurpose?: string }>;
    const persistedWorkspaces = JSON.parse(
      await readFile(path.join(daemon.paseoHome, "projects", "workspaces.json"), "utf8"),
    ) as Array<{ internalPurpose?: string }>;
    expect(persistedProjects.filter((project) => project.internalPurpose === "chat")).toHaveLength(
      1,
    );
    expect(
      persistedWorkspaces.filter((workspace) => workspace.internalPurpose === "chat"),
    ).toHaveLength(1);
  } finally {
    await Promise.all([firstClient.close(), secondClient.close()]);
    await daemon.close();
  }
});

test("daemon restart restores the same hidden Chat workspace identity", async () => {
  const paseoHomeRoot = await mkdtemp(path.join(tmpdir(), "paseo-hidden-chat-restart-"));
  const staticDirectories: string[] = [];

  try {
    const firstDaemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      cleanup: false,
      mcpEnabled: false,
    });
    staticDirectories.push(firstDaemon.staticDir);
    const firstClient = new DaemonClient({
      url: `ws://127.0.0.1:${firstDaemon.port}/ws`,
      appVersion: "0.7.0",
    });
    let firstWorkspace: Awaited<ReturnType<DaemonClient["resolveChatWorkspace"]>>["workspace"];
    try {
      await firstClient.connect();
      firstWorkspace = (await firstClient.resolveChatWorkspace("resolve-before-restart")).workspace;
      expect(firstWorkspace).not.toBeNull();
    } finally {
      await firstClient.close();
      await firstDaemon.close();
    }

    const secondDaemon = await createTestPaseoDaemon({
      paseoHomeRoot,
      cleanup: false,
      mcpEnabled: false,
    });
    staticDirectories.push(secondDaemon.staticDir);
    const secondClient = new DaemonClient({
      url: `ws://127.0.0.1:${secondDaemon.port}/ws`,
      appVersion: "0.7.0",
    });
    try {
      await secondClient.connect();
      const restored = await secondClient.resolveChatWorkspace("resolve-after-restart");
      expect(restored.workspace).toEqual(firstWorkspace);
    } finally {
      await secondClient.close();
      await secondDaemon.close();
    }
  } finally {
    await Promise.all([
      rm(paseoHomeRoot, { recursive: true, force: true }),
      ...staticDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    ]);
  }
});
