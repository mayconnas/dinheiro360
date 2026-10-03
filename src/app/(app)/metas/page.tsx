import { getGoals } from "@/lib/data/repository";
import { GoalsView } from "@/components/goals-view";

export default async function MetasPage() {
  const goals = await getGoals();
  return <GoalsView goals={goals} />;
}
