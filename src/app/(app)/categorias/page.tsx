import { listAccountTree } from "@/app/actions/config";
import { CategoriasView } from "@/components/categorias-view";

// ─────────────────────────────────────────────────────────────
// Casa do Plano de Contas: criar contas e subcontas (profundidade
// ilimitada), renomear, mudar cor/natureza, mover na árvore e
// excluir. Tela própria (não uma aba dentro de Transações/Orçamento)
// porque categoria é uma entidade transversal — orçamento, transações
// e o Gestor (IA) dependem dela, então merece navegação de primeiro
// nível (ver item "Categorias" em src/components/app-shell.tsx — a
// ROTA continua /categorias de propósito, só o título mudou para
// "Plano de Contas": é onde o usuário já aprendeu a encontrar isso).
//
// Todas as categorias padrão são is_system=true, mas o usuário pode
// renomear/mudar cor/mover elas na árvore normalmente (decisão de
// produto — só o `kind` receita/despesa é imutável depois de criada).
// Ao excluir um nó, os FILHOS são reparentados para o avô (a subárvore
// não é apagada) e as transações amarradas diretamente a ele migram
// para "A revisar" (ver deleteCategory em src/app/actions/config.ts)
// — nunca deixa transação órfã nem árvore quebrada.
// ─────────────────────────────────────────────────────────────
export default async function CategoriasPage() {
  const tree = await listAccountTree();
  return <CategoriasView tree={tree} />;
}
