import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { createHiddenChatWorkspaceService } from "./hidden-chat-workspace-service.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
} from "./workspace-registry.js";

describe("hidden Chat workspace", () => {
  let paseoHome: string;
  let projectRegistry: FileBackedProjectRegistry;
  let workspaceRegistry: FileBackedWorkspaceRegistry;

  beforeEach(async () => {
    paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-hidden-chat-"));
    projectRegistry = new FileBackedProjectRegistry(
      path.join(paseoHome, "projects", "projects.json"),
      createTestLogger(),
    );
    workspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(paseoHome, "projects", "workspaces.json"),
      createTestLogger(),
    );
  });

  afterEach(async () => {
    await rm(paseoHome, { recursive: true, force: true });
  });

  test("concurrent first use creates one hidden workspace and restores it", async () => {
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry,
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    });

    const [first, second] = await Promise.all([service.resolve(), service.resolve()]);
    expect(second).toEqual(first);
    expect((await stat(first.cwd)).isDirectory()).toBe(true);

    const projects = await projectRegistry.list();
    const workspaces = await workspaceRegistry.list();
    expect(projects).toHaveLength(1);
    expect(workspaces).toHaveLength(1);
    expect(projects[0]?.internalPurpose).toBe("chat");
    expect(workspaces[0]).toMatchObject({
      workspaceId: first.workspaceId,
      projectId: projects[0]?.projectId,
      cwd: first.cwd,
      internalPurpose: "chat",
    });

    const reloadedService = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry: new FileBackedProjectRegistry(
        path.join(paseoHome, "projects", "projects.json"),
        createTestLogger(),
      ),
      workspaceRegistry: new FileBackedWorkspaceRegistry(
        path.join(paseoHome, "projects", "workspaces.json"),
        createTestLogger(),
      ),
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(await reloadedService.resolve()).toEqual(first);
  });

  test("fails closed when the hidden project and workspace records disagree", async () => {
    const chatDirectory = path.join(paseoHome, "runtime", "chat-workspace");
    await projectRegistry.upsert(
      createPersistedProjectRecord({
        projectId: "prj_hidden_a",
        internalPurpose: "chat",
        rootPath: chatDirectory,
        kind: "non_git",
        displayName: "Chat",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    );
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_hidden",
        projectId: "prj_hidden_b",
        internalPurpose: "chat",
        cwd: chatDirectory,
        kind: "directory",
        displayName: "Chat",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    );
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry,
    });

    await expect(service.resolve()).rejects.toMatchObject({ code: "duplicate_records" });
    expect(await projectRegistry.list()).toHaveLength(1);
  });

  test("repairs a missing project and restores its archived workspace", async () => {
    const chatDirectory = path.join(paseoHome, "runtime", "chat-workspace");
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_hidden",
        projectId: "prj_hidden",
        internalPurpose: "chat",
        cwd: chatDirectory,
        kind: "directory",
        displayName: "Chat",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
        archivedAt: "2026-09-03T00:00:00.000Z",
      }),
    );
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    await expect(service.resolve()).resolves.toEqual({
      workspaceId: "wks_hidden",
      cwd: chatDirectory,
    });
    expect(await projectRegistry.get("prj_hidden")).toMatchObject({
      projectId: "prj_hidden",
      internalPurpose: "chat",
      archivedAt: null,
    });
    expect(await workspaceRegistry.get("wks_hidden")).toMatchObject({ archivedAt: null });
  });

  test("rejects hidden records outside the daemon-owned directory", async () => {
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_hidden",
        projectId: "prj_hidden",
        internalPurpose: "chat",
        cwd: path.join(paseoHome, "other"),
        kind: "directory",
        displayName: "Chat",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    );
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry,
    });

    await expect(service.resolve()).rejects.toMatchObject({ code: "ownership_conflict" });
    expect(await projectRegistry.list()).toEqual([]);
  });

  test("rejects duplicate hidden project records", async () => {
    const chatDirectory = path.join(paseoHome, "runtime", "chat-workspace");
    for (const projectId of ["prj_hidden_a", "prj_hidden_b"]) {
      await projectRegistry.upsert(
        createPersistedProjectRecord({
          projectId,
          internalPurpose: "chat",
          rootPath: chatDirectory,
          kind: "non_git",
          displayName: "Chat",
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
        }),
      );
    }
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry,
    });

    await expect(service.resolve()).rejects.toMatchObject({ code: "duplicate_records" });
  });

  test("rolls back a newly created project with an internal mutation marker", async () => {
    const mutations: unknown[] = [];
    projectRegistry.subscribeToMutations((mutation) => mutations.push(mutation));
    const failingWorkspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(paseoHome, "projects", "failing-new-workspaces.json"),
      createTestLogger(),
      {
        writeRecords: async () => {
          throw new Error("workspace write failed");
        },
      },
    );
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry: failingWorkspaceRegistry,
    });

    await expect(service.resolve()).rejects.toThrow("workspace write failed");
    expect(await projectRegistry.list()).toEqual([]);
    expect(mutations.at(-1)).toMatchObject({
      kind: "remove",
      internalPurpose: "chat",
    });
  });

  test("preserves an existing hidden project when workspace persistence fails", async () => {
    const chatDirectory = path.join(paseoHome, "runtime", "chat-workspace");
    await projectRegistry.upsert(
      createPersistedProjectRecord({
        projectId: "prj_hidden",
        internalPurpose: "chat",
        rootPath: chatDirectory,
        kind: "non_git",
        displayName: "Chat",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    );
    const failingWorkspaceRegistry = new FileBackedWorkspaceRegistry(
      path.join(paseoHome, "projects", "failing-workspaces.json"),
      createTestLogger(),
      {
        writeRecords: async () => {
          throw new Error("workspace write failed");
        },
      },
    );
    const service = createHiddenChatWorkspaceService({
      paseoHome,
      projectRegistry,
      workspaceRegistry: failingWorkspaceRegistry,
    });

    await expect(service.resolve()).rejects.toThrow("workspace write failed");
    expect(await projectRegistry.get("prj_hidden")).toMatchObject({
      projectId: "prj_hidden",
      internalPurpose: "chat",
    });
  });
});
