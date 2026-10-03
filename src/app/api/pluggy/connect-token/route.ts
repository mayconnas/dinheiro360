// POST /api/pluggy/connect-token
// Gera o accessToken (curta duração) para o widget Pluggy Connect.
// EXIGE sessão de usuário. O CLIENT_SECRET nunca sai do servidor:
// aqui só devolvemos o token de 30min que o widget consome.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createConnectToken } from "@/lib/pluggy/client";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  try {
    const webhookUrl = process.env.PLUGGY_WEBHOOK_URL;
    const accessToken = await createConnectToken({
      clientUserId: user.id,
      ...(webhookUrl ? { webhookUrl } : {}),
    });
    return NextResponse.json({ accessToken });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "erro ao gerar token" },
      { status: 500 }
    );
  }
}
