import { listConnections } from "@/app/actions/pluggy";
import { ConnectionsView } from "@/components/connections-view";

// ─────────────────────────────────────────────────────────────
// Wrapper server component: reaproveita 100% a tela de Conexões
// (Open Finance / Pluggy) já existente, só que embutida como o
// conteúdo da aba "conexoes" dentro de /configuracoes.
//
// Mesmo padrão de src/app/(app)/conexoes/page.tsx: busca
// listConnections() (server action) aqui no server e passa como prop
// pra <ConnectionsView>, que é client (usa useState/useTransition e o
// widget da Pluggy, que só roda no browser). Nenhuma lógica do Pluggy
// foi tocada — conectar banco, listar, sincronizar e desconectar
// continuam idênticos ao que /conexoes já fazia.
//
// Sem props: este componente é assíncrono e busca seus próprios dados,
// então o server component de Configurações só precisa renderizar
// <ConnectionsSection /> dentro do slot da aba — não precisa buscar
// nada de Pluggy por conta própria. (Ver alternativa comentada em
// configuracoes/page.tsx caso prefiram buscar tudo num único
// Promise.all lá em cima; ambos os padrões funcionam, este aqui é o
// mais simples e replica exatamente conexoes/page.tsx.)
// ─────────────────────────────────────────────────────────────

export async function ConnectionsSection() {
  const connections = await listConnections();
  return <ConnectionsView connections={connections} />;
}
