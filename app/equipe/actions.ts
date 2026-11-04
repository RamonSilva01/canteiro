"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { exigirPerfil } from "@/lib/sessao";
import { createAdminClient } from "@/lib/supabase/admin";
import { texto } from "@/lib/format";

export type EstadoConvite = { link?: string; nome?: string; erro?: string };

const PAPEIS = ["admin", "colaborador", "cliente"] as const;

async function baseDoSite() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/**
 * Link de acesso de uso único (validade de 24 h). Sem serviço de e-mail configurado,
 * o admin copia e manda por WhatsApp (US-15). Usuário novo recebe "invite",
 * quem já existe recebe "recovery"; os dois caem em /definir-senha.
 */
async function gerarLink(email: string, nome: string | null) {
  const admin = createAdminClient();
  let { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { nome } } });
  let tipo = "invite";
  if (error && /already|registered|exists/i.test(error.message)) {
    ({ data, error } = await admin.auth.admin.generateLink({ type: "recovery", email }));
    tipo = "recovery";
  }
  if (error || !data?.properties?.hashed_token || !data.user) throw new Error(error?.message ?? "falha ao gerar o link");
  const link = `${await baseDoSite()}/auth/confirmar?token_hash=${data.properties.hashed_token}&type=${tipo}`;
  return { link, userId: data.user.id };
}

export async function convidar(_: EstadoConvite, fd: FormData): Promise<EstadoConvite> {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") return { erro: "Só o administrador convida pessoas." };

  const nome = texto(fd.get("nome"));
  const email = texto(fd.get("email"))?.toLowerCase() ?? "";
  const papel = String(fd.get("papel")) as (typeof PAPEIS)[number];
  const obras = fd.getAll("obra").map(String);
  if (!nome || !email.includes("@")) return { erro: "Preencha nome e e-mail." };
  if (!PAPEIS.includes(papel)) return { erro: "Papel inválido." };
  if (papel !== "admin" && obras.length === 0) return { erro: "Escolha ao menos uma obra para essa pessoa." };

  try {
    const { link, userId } = await gerarLink(email, nome);
    const admin = createAdminClient();

    // Perfil só pode ser criado com a chave secreta (não há policy de insert em perfis).
    const { data: existente } = await admin.from("perfis").select("empresa_id").eq("id", userId).maybeSingle();
    if (existente && existente.empresa_id !== perfil.empresa_id) {
      return { erro: "Este e-mail já usa o Canteiro por outra empresa." };
    }
    if (!existente) {
      const { error } = await admin.from("perfis").insert({ id: userId, empresa_id: perfil.empresa_id, papel, nome, email });
      if (error) return { erro: `Não foi possível criar o perfil (${error.message}).` };
    }

    // Vínculo com as obras pela sessão do admin: a RLS confere que as obras são da empresa dele.
    if (obras.length) {
      const { error } = await supabase
        .from("obra_membros")
        .upsert(
          obras.map((obra_id) => ({ obra_id, usuario_id: userId, vinculado_por: perfil.id })),
          { onConflict: "obra_id,usuario_id", ignoreDuplicates: true },
        );
      if (error) return { erro: `Perfil criado, mas falhou o vínculo com as obras (${error.message}).` };
    }

    revalidatePath("/equipe");
    return { link, nome };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Novo link de acesso para quem perdeu o convite ou esqueceu a senha. */
export async function novoLink(usuarioId: string): Promise<EstadoConvite> {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") return { erro: "Só o administrador gera links." };

  const { data: pessoa } = await supabase.from("perfis").select("nome, email").eq("id", usuarioId).maybeSingle();
  if (!pessoa) return { erro: "Pessoa não encontrada." };
  try {
    const { link } = await gerarLink(pessoa.email, pessoa.nome);
    return { link, nome: pessoa.nome };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Marca e desmarca as obras de uma pessoa, e liga/desliga o acesso dela. */
export async function salvarAcesso(usuarioId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin" || usuarioId === perfil.id) return;

  const marcadas = new Set(fd.getAll("obra").map(String));
  const { data: atuais } = await supabase.from("obra_membros").select("obra_id").eq("usuario_id", usuarioId);
  const atuaisSet = new Set((atuais ?? []).map((m) => m.obra_id as string));

  const entrar = [...marcadas].filter((o) => !atuaisSet.has(o));
  const sair = [...atuaisSet].filter((o) => !marcadas.has(o));
  if (entrar.length) {
    await supabase.from("obra_membros").insert(entrar.map((obra_id) => ({ obra_id, usuario_id: usuarioId, vinculado_por: perfil.id })));
  }
  if (sair.length) await supabase.from("obra_membros").delete().eq("usuario_id", usuarioId).in("obra_id", sair);

  await supabase.from("perfis").update({ ativo: fd.get("ativo") === "on" }).eq("id", usuarioId);
  revalidatePath("/equipe");
}
