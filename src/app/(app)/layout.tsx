import { redirect } from "next/navigation";
import { createClient, getUserClaims } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/repository";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lê as claims do JWT do cookie — SEM round-trip ao Auth. O middleware
  // já valida a sessão de verdade a cada navegação e redireciona quem não
  // está logado; aqui só precisamos do nome/email do token. Isso corta o
  // 2º getUser() que dominava o tempo de troca de aba.
  const claims = await getUserClaims();
  if (!claims) redirect("/login");

  const name = claims.displayName || claims.email?.split("@")[0] || "Você";

  // Bootstrap idempotente: só chama a RPC pesada quando o perfil ainda não
  // existe (primeiro login). getProfile é cacheado por request (React
  // cache), então a mesma leitura é reusada pelo dashboard/perfil no mesmo
  // render — não vira query duplicada. (Não escrevemos cookie aqui: Server
  // Components não podem modificar cookies.)
  const profile = await getProfile();
  if (!profile) {
    const supabase = await createClient();
    await supabase.rpc("bootstrap_user", { p_display_name: name });
  }

  return <AppShell userName={name}>{children}</AppShell>;
}
