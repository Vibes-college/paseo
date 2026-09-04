import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { ChatScreen } from "@/screens/chat/chat-screen";

export default function HostChatRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostChatRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostChatRouteContent() {
  const serverId = useHostRouteServerId();
  if (!serverId) return null;
  return <ChatScreen serverId={serverId} />;
}
