import { listPayees } from "@/app/actions/payees";
import { getCategories } from "@/lib/data/repository";
import { PayeesView } from "@/components/payees-view";

// ─────────────────────────────────────────────────────────────
// Casa do cadastro de Destinatários (payees): pessoas e
// estabelecimentos com quem o usuário transaciona (pago ou recebido).
// Preenchimento é automático (toda nova transação resolve/cria o
// payee sozinha — ver src/lib/data/payees-repo.ts) + retroativo via o
// botão de backfill nesta tela, que roda sobre o histórico já
// importado. Listagem é Server Component; interação (busca, botão de
// backfill) fica no client PayeesView.
//
// Categorias são passadas para permitir amarrar cada destinatário a
// uma categoria padrão (setPayeeCategory) direto no card — ver
// PayeeCategorySelect dentro de payees-view.tsx.
// ─────────────────────────────────────────────────────────────
export default async function DestinatariosPage() {
  const [payees, categories] = await Promise.all([listPayees(), getCategories()]);
  return <PayeesView payees={payees} categories={categories} />;
}
