import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { generateProjectId, generateWorkspaceId } from "./workspace-registry-model.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";

export interface HiddenChatWorkspace {
  workspaceId: string;
  cwd: string;
}

interface HiddenChatWorkspaceServiceDependencies {
  paseoHome: string;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  now?: () => Date;
}

export interface HiddenChatWorkspaceService {
  resolve(): Promise<HiddenChatWorkspace>;
}

export class HiddenChatWorkspaceError extends Error {
  constructor(
    readonly code: "duplicate_records" | "ownership_conflict",
    message: string,
  ) {
    super(message);
    this.name = "HiddenChatWorkspaceError";
  }
}

export function createHiddenChatWorkspaceService(
  dependencies: HiddenChatWorkspaceServiceDependencies,
): HiddenChatWorkspaceService {
  const chatDirectory = resolve(dependencies.paseoHome, "runtime", "chat-workspace");
  const now = dependencies.now ?? (() => new Date());
  let pending: Promise<HiddenChatWorkspace> | null = null;

  async function resolveWorkspace(): Promise<HiddenChatWorkspace> {
    await mkdir(chatDirectory, { recursive: true, mode: 0o700 });
    const projects = sortByCreation(
      (await dependencies.projectRegistry.list()).filter(
        (project) => project.internalPurpose === "chat",
      ),
      (project) => project.projectId,
    );
    const workspaces = sortByCreation(
      (await dependencies.workspaceRegistry.list()).filter(
        (workspace) => workspace.internalPurpose === "chat",
      ),
      (workspace) => workspace.workspaceId,
    );
    if (projects.length > 1 || workspaces.length > 1) {
      throw new HiddenChatWorkspaceError(
        "duplicate_records",
        "Hidden Chat workspace storage contains duplicate records",
      );
    }

    const workspace = workspaces[0];
    if (workspace) {
      const hiddenProject = projects[0];
      if (hiddenProject && hiddenProject.projectId !== workspace.projectId) {
        throw new HiddenChatWorkspaceError(
          "duplicate_records",
          "Hidden Chat project and workspace records disagree",
        );
      }
      return restoreWorkspace(workspace);
    }
    const existingProject = projects[0];
    if (existingProject) return createWorkspace(existingProject, false);
    return createWorkspace(await createProject(), true);
  }

  async function restoreWorkspace(
    workspace: PersistedWorkspaceRecord,
  ): Promise<HiddenChatWorkspace> {
    if (resolve(workspace.cwd) !== chatDirectory) {
      throw new HiddenChatWorkspaceError(
        "ownership_conflict",
        "Hidden Chat workspace points outside its daemon-owned directory",
      );
    }
    let project = await dependencies.projectRegistry.get(workspace.projectId);
    if (project && project.internalPurpose !== "chat") {
      throw new HiddenChatWorkspaceError(
        "ownership_conflict",
        "Hidden Chat workspace project is owned by another product surface",
      );
    }
    if (!project) {
      project = await createProject(workspace.projectId);
    } else if (resolve(project.rootPath) !== chatDirectory) {
      throw new HiddenChatWorkspaceError(
        "ownership_conflict",
        "Hidden Chat project points outside its daemon-owned directory",
      );
    } else if (project.archivedAt) {
      project = { ...project, archivedAt: null, updatedAt: now().toISOString() };
      await dependencies.projectRegistry.upsert(project);
    }
    if (workspace.archivedAt) {
      await dependencies.workspaceRegistry.upsert({
        ...workspace,
        archivedAt: null,
        updatedAt: now().toISOString(),
      });
    }
    return { workspaceId: workspace.workspaceId, cwd: chatDirectory };
  }

  async function createProject(projectId = generateProjectId()): Promise<PersistedProjectRecord> {
    const timestamp = now().toISOString();
    const project = createPersistedProjectRecord({
      projectId,
      internalPurpose: "chat",
      rootPath: chatDirectory,
      kind: "non_git",
      displayName: "Chat",
      projectKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await dependencies.projectRegistry.upsert(project);
    return project;
  }

  async function createWorkspace(
    project: PersistedProjectRecord,
    removeProjectOnFailure: boolean,
  ): Promise<HiddenChatWorkspace> {
    if (resolve(project.rootPath) !== chatDirectory) {
      throw new HiddenChatWorkspaceError(
        "ownership_conflict",
        "Hidden Chat project points outside its daemon-owned directory",
      );
    }
    const timestamp = now().toISOString();
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      projectId: project.projectId,
      internalPurpose: "chat",
      cwd: chatDirectory,
      kind: "directory",
      displayName: "Chat",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      await dependencies.workspaceRegistry.upsert(workspace);
    } catch (error) {
      if (removeProjectOnFailure) {
        await dependencies.projectRegistry.remove(project.projectId).catch(() => undefined);
      }
      throw error;
    }
    return { workspaceId: workspace.workspaceId, cwd: chatDirectory };
  }

  return {
    resolve() {
      if (pending) return pending;
      pending = resolveWorkspace().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

function sortByCreation<T extends { createdAt: string }>(records: T[], id: (record: T) => string) {
  return records.sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) || id(left).localeCompare(id(right)),
  );
}
