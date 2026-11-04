import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Foto = {
  id: string;
  post_id: string;
  url: string;
  legenda: string | null;
  etapa_id: string | null;
  publicado_em: string;
};

// Bucket privado: cada foto sai com URL assinada de validade curta (1 hora).
async function assinar(supabase: SupabaseClient, midias: { id: string; storage_path: string; legenda: string | null; post: unknown }[]) {
  if (midias.length === 0) return [];
  const { data: urls } = await supabase.storage.from("obra-fotos").createSignedUrls(
    midias.map((m) => m.storage_path),
    3600,
  );
  const porPath = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
  return midias.flatMap((m) => {
    const post = m.post as { id: string; etapa_id: string | null; publicado_em: string; texto: string | null };
    const url = porPath.get(m.storage_path);
    return url
      ? [{ id: m.id, post_id: post.id, url, legenda: m.legenda ?? post.texto, etapa_id: post.etapa_id, publicado_em: post.publicado_em }]
      : [];
  });
}

/** Fotos publicadas da obra, da mais recente para a mais antiga. */
export async function fotosRecentes(supabase: SupabaseClient, obraId: string, limite = 500): Promise<Foto[]> {
  const { data } = await supabase
    .from("post_midias")
    .select("id, storage_path, legenda, post:posts!inner(id, etapa_id, publicado_em, texto, excluido_em)")
    .eq("obra_id", obraId)
    .is("post.excluido_em", null)
    .not("post.publicado_em", "is", null)
    .order("criada_em", { ascending: false })
    .limit(limite);
  return assinar(supabase, data ?? []);
}
