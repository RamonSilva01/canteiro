"use server";

import { revalidatePath } from "next/cache";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";

export type FotoEnviada = { path: string; mime: string; tamanho: number; largura: number; altura: number };

// O navegador já subiu as fotos (reduzidas) para o bucket obra-fotos.
// Um post por envio, com todas as fotos dele; publicado na hora para o cliente.
export async function registrarFotos(
  obraId: string,
  dados: { etapaId: string | null; legenda: string | null; fotos: FotoEnviada[] },
): Promise<string | null> {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) return "Sem permissão.";
  if (dados.fotos.length === 0) return "Nenhuma foto enviada.";

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      obra_id: obraId,
      etapa_id: dados.etapaId,
      autor_id: perfil.id,
      tipo: "foto",
      texto: dados.legenda,
      publicado_em: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !post) return `Não foi possível registrar as fotos (${error?.message}).`;

  const { error: erroMidias } = await supabase.from("post_midias").insert(
    dados.fotos.map((f, i) => ({
      post_id: post.id,
      obra_id: obraId,
      storage_path: f.path,
      mime_type: f.mime,
      tamanho_bytes: f.tamanho,
      largura: f.largura,
      altura: f.altura,
      ordem: i,
    })),
  );
  if (erroMidias) return `Não foi possível registrar as fotos (${erroMidias.message}).`;

  revalidatePath(`/obras/${obraId}`, "layout");
  return null;
}

export async function removerFoto(obraId: string, postId: string) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) return;
  // Some do cliente e da galeria; o arquivo fica no bucket (remoção física é só admin).
  await supabase.from("posts").update({ excluido_em: new Date().toISOString() }).eq("id", postId).eq("obra_id", obraId);
  revalidatePath(`/obras/${obraId}`, "layout");
}
