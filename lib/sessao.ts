import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Perfil = { id: string; nome: string; papel: "admin" | "colaborador" | "cliente"; empresa_id: string };

export async function sessao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("perfis")
    .select("id, nome, papel, empresa_id, ativo")
    .eq("id", user.id)
    .maybeSingle<Perfil & { ativo: boolean }>();
  // O banco já bloqueia os dados de quem foi desligado; aqui só explica o porquê.
  if (perfil && !perfil.ativo) redirect("/login?erro=desligado");

  return { supabase, user, perfil };
}

/** Para páginas e actions que exigem perfil; sem perfil volta para a home (aviso do bootstrap). */
export async function exigirPerfil() {
  const s = await sessao();
  if (!s.perfil) redirect("/");
  return { ...s, perfil: s.perfil };
}

export const ehEquipe = (p: Perfil) => p.papel !== "cliente";
