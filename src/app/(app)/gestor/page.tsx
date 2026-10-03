import { getTransactions } from "@/lib/data/repository";
import { AdvisorChat } from "@/components/advisor-chat";

export default async function GestorPage() {
  const txs = await getTransactions();
  const hasData = txs.some((t) => !t.isDuplicate);
  return <AdvisorChat hasData={hasData} />;
}
