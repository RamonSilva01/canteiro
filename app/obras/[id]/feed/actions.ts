"use server";

import { revalidatePath } from "next/cache";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { feedAtivo } from "@/lib/recursos";
import { texto } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const caminho = (obraId: string) => `/obras/${obraId}/feed`;

export async function publicarTexto(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  const conteudo = texto(fd.get("texto"));
  if (!feedAtivo() || !ehEquipe(perfil) || !conteudo) return;

  await supabase.from("posts").insert({
    obra_id: obraId,
    etapa_id: texto(fd.get("etapa")),
    autor_id: perfil.id,
    tipo: "texto",
    texto: conteudo,
    publicado_em: new Date().toISOString(),
  });
  revalidatePath(caminho(obraId));
}

export async function comentar(obraId: string, postId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  const conteudo = texto(fd.get("texto"));
  if (!feedAtivo() || !conteudo) return;

  await supabase.from("comentarios").insert({ post_id: postId, obra_id: obraId, autor_id: perfil.id, texto: conteudo });
  revalidatePath(caminho(obraId));
}

export async function removerComentario(obraId: string, comentarioId: string) {
  const { supabase, perfil } = await exigirPerfil();
  if (!feedAtivo()) return;

  // A regra de leitura esconde comentário excluído, o que também barra o update pela sessão.
  // Por isso a permissão é conferida aqui: a leitura pela sessão garante que ele vê o comentário.
  const { data: comentario } = await supabase.from("comentarios").select("autor_id").eq("id", comentarioId).eq("obra_id", obraId).maybeSingle();
  if (!comentario || (comentario.autor_id !== perfil.id && perfil.papel !== "admin")) return;

  await createAdminClient().from("comentarios").update({ excluido_em: new Date().toISOString() }).eq("id", comentarioId).eq("obra_id", obraId);
  revalidatePath(caminho(obraId));
}

export async function alternarCurtida(obraId: string, postId: string, curtiu: boolean) {
  const { supabase, perfil } = await exigirPerfil();
  if (!feedAtivo()) return;

  if (curtiu) {
    await supabase.from("curtidas").delete().eq("post_id", postId).eq("usuario_id", perfil.id);
  } else {
    await supabase.from("curtidas").insert({ post_id: postId, obra_id: obraId, usuario_id: perfil.id });
  }
  revalidatePath(caminho(obraId));
}
