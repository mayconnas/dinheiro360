import { listConnections } from "@/app/actions/pluggy";
import { ConnectionsView } from "@/components/connections-view";

export default async function ConexoesPage() {
  const connections = await listConnections();
  return <ConnectionsView connections={connections} />;
}
