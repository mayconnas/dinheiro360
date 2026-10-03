import { getProfile, getAccounts } from "@/lib/data/repository";
import { ProfileView } from "@/components/profile-view";

export default async function PerfilPage() {
  const [profile, accounts] = await Promise.all([getProfile(), getAccounts()]);
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-muted-foreground">Perfil não encontrado.</p>
      </div>
    );
  }
  return <ProfileView profile={profile} accounts={accounts} />;
}
