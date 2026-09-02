import { describe, expect, test } from "vitest";
import type {
  GetProvidersSnapshotResponseMessage,
  ServerInfoStatusPayload,
} from "@getpaseo/protocol/messages";
import type { ChatWorkspaceResolvePayload } from "@getpaseo/client/internal/daemon-client";
import type { FormPreferences } from "@/create-agent-preferences/preferences";

import { resolveChatRuntime, type ChatRuntimeClient } from "./chat-runtime-resolution";

type ProviderSnapshotPayload = GetProvidersSnapshotResponseMessage["payload"];

class ChatRuntimeClientAdapter implements ChatRuntimeClient {
  readonly calls: string[] = [];

  constructor(
    private readonly serverInfo: ServerInfoStatusPayload | null,
    private readonly workspaceResult: ChatWorkspaceResolvePayload,
    private readonly providerResult: ProviderSnapshotPayload,
  ) {}

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.serverInfo;
  }

  async resolveChatWorkspace(): Promise<ChatWorkspaceResolvePayload> {
    this.calls.push("workspace");
    return this.workspaceResult;
  }

  async getProvidersSnapshot(options?: { cwd?: string }): Promise<ProviderSnapshotPayload> {
    this.calls.push(`providers:${options?.cwd ?? ""}`);
    return this.providerResult;
  }
}

const workspaceResult: ChatWorkspaceResolvePayload = {
  requestId: "resolve-chat",
  workspace: {
    workspaceId: "wks_chat",
    cwd: "/runtime/chat-workspace",
  },
  error: null,
};

function createServerInfo(chatWorkspace: boolean): ServerInfoStatusPayload {
  return {
    status: "server_info",
    serverId: "srv_test",
    hostname: null,
    version: null,
    features: { chatWorkspace },
  };
}

function providerSnapshot(entries: ProviderSnapshotPayload["entries"]): ProviderSnapshotPayload {
  return {
    requestId: "providers-chat",
    cwd: "/runtime/chat-workspace",
    entries,
    generatedAt: "2026-09-02T00:00:00.000Z",
  };
}

describe("Chat runtime resolution", () => {
  test("gates unsupported hosts before sending the hidden workspace RPC", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(false),
      workspaceResult,
      providerSnapshot([]),
    );

    await expect(resolveChatRuntime({ client, preferences: {} })).resolves.toEqual({
      status: "unsupported",
      code: "host_update_required",
    });
    expect(client.calls).toEqual([]);
  });

  test("returns a non-retryable failure for conflicting hidden workspace ownership", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(true),
      {
        requestId: "resolve-chat",
        workspace: null,
        error: {
          code: "ownership_conflict",
          message: "Hidden Chat storage is owned by another surface",
        },
      },
      providerSnapshot([]),
    );

    await expect(resolveChatRuntime({ client, preferences: {} })).resolves.toEqual({
      status: "error",
      code: "workspace_ownership_conflict",
      retryable: false,
    });
    expect(client.calls).toEqual(["workspace"]);
  });

  test("resolves the preferred ready provider, model, mode, and thinking option", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(true),
      workspaceResult,
      providerSnapshot([
        {
          provider: "codex",
          status: "ready",
          enabled: true,
          defaultModeId: "full-access",
          modes: [
            { id: "ask", label: "Ask" },
            { id: "full-access", label: "Full access" },
          ],
          models: [
            {
              provider: "codex",
              id: "gpt-default",
              label: "Default",
              isDefault: true,
            },
            {
              provider: "codex",
              id: "gpt-chat",
              aliases: ["chat-alias"],
              label: "Chat",
              thinkingOptions: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
              ],
              defaultThinkingOptionId: "medium",
            },
          ],
        },
      ]),
    );
    const preferences: FormPreferences = {
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "chat-alias",
          mode: "full-access",
          thinkingByModel: { "gpt-chat": "high" },
          featureValues: { fast: true },
        },
      },
    };

    await expect(resolveChatRuntime({ client, preferences })).resolves.toEqual({
      status: "ready",
      workspace: {
        workspaceId: "wks_chat",
        cwd: "/runtime/chat-workspace",
      },
      agentDefaults: {
        provider: "codex",
        model: "gpt-chat",
        modeId: "full-access",
        thinkingOptionId: "high",
        featureValues: { fast: true },
      },
    });
    expect(client.calls).toEqual(["workspace", "providers:/runtime/chat-workspace"]);
  });

  test("chooses the first ready provider by stable ID when no preference exists", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(true),
      workspaceResult,
      providerSnapshot([
        {
          provider: "zed",
          status: "ready",
          enabled: true,
          models: [{ provider: "zed", id: "zed-model", label: "Zed" }],
        },
        {
          provider: "alpha",
          status: "ready",
          enabled: true,
          defaultModeId: "ask",
          modes: [{ id: "ask", label: "Ask" }],
          models: [
            {
              provider: "alpha",
              id: "alpha-default",
              label: "Alpha",
              isDefault: true,
              thinkingOptions: [{ id: "medium", label: "Medium" }],
              defaultThinkingOptionId: "medium",
            },
          ],
        },
      ]),
    );

    await expect(resolveChatRuntime({ client, preferences: {} })).resolves.toMatchObject({
      status: "ready",
      agentDefaults: {
        provider: "alpha",
        model: "alpha-default",
        modeId: "ask",
        thinkingOptionId: "medium",
      },
    });
  });

  test("keeps an unavailable preferred provider as a visible retryable failure", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(true),
      workspaceResult,
      providerSnapshot([
        {
          provider: "codex",
          status: "unavailable",
          enabled: true,
          error: "Provider is unavailable",
        },
      ]),
    );

    await expect(
      resolveChatRuntime({ client, preferences: { provider: "codex" } }),
    ).resolves.toEqual({
      status: "error",
      code: "provider_unavailable",
      retryable: true,
    });
  });

  test("returns a retryable pending state while the only enabled provider loads", async () => {
    const client = new ChatRuntimeClientAdapter(
      createServerInfo(true),
      workspaceResult,
      providerSnapshot([
        {
          provider: "codex",
          status: "loading",
          enabled: true,
        },
      ]),
    );

    await expect(resolveChatRuntime({ client, preferences: {} })).resolves.toEqual({
      status: "pending",
      code: "provider_catalog_loading",
      workspace: {
        workspaceId: "wks_chat",
        cwd: "/runtime/chat-workspace",
      },
      retryable: true,
    });
  });
});
