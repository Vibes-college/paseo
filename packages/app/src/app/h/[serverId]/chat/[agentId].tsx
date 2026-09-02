import { useLocalSearchParams } from "expo-router";

import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { ChatScreen } from "@/screens/chat/chat-screen";

export default function HostChatAgentRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostChatAgentRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostChatAgentRouteContent() {
  const serverId = useHostRouteServerId();
  const params = useLocalSearchParams<{ agentId?: string | string[] }>();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  if (!serverId) return null;
  return <ChatScreen serverId={serverId} agentId={agentId} />;
}
