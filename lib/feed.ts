import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type Comentario = { id: string; autor_id: string; autor: string; texto: string; criado_em: string; da_equipe: boolean };
export type Post = {
  id: string;
  tipo: "texto" | "foto" | "video" | "marco";
  autor: string;
  etapa: string | null;
  titulo: string | null;
  texto: string | null;
  publicado_em: string;
  fotos: { id: string; url: string; legenda: string | null }[];
  comentarios: Comentario[];
  curtidas: number;
  curti: boolean;
};

export const FILTROS = [
  { chave: "tudo", rotulo: "Tudo" },
  { chave: "marcos", rotulo: "Marcos de etapa" },
  { chave: "fotos", rotulo: "Só fotos" },
  { chave: "comentarios", rotulo: "Com comentários" },
] as const;

/** Feed em ordem cronológica, do mais novo para o mais antigo, sem algoritmo. */
export async function carregarFeed(supabase: SupabaseClient, obraId: string, usuarioId: string, filtro = "tudo") {
  const [{ data: posts }, { data: etapas }, { count: total }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, tipo, etapa_id, autor_id, titulo, texto, publicado_em")
      .eq("obra_id", obraId)
      .eq("visivel_cliente", true)
      .is("excluido_em", null)
      .not("publicado_em", "is", null)
      .order("publicado_em", { ascending: false })
      .limit(100),
    supabase.from("etapas").select("id, nome").eq("obra_id", obraId),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("obra_id", obraId)
      .eq("visivel_cliente", true)
      .is("excluido_em", null)
      .not("publicado_em", "is", null),
  ]);
  const ids = (posts ?? []).map((p) => p.id as string);
  if (ids.length === 0) return { posts: [] as Post[], total: total ?? 0 };

  const [{ data: midias }, { data: comentarios }, { data: curtidas }] = await Promise.all([
    supabase.from("post_midias").select("id, post_id, storage_path, legenda").in("post_id", ids).order("ordem"),
    supabase.from("comentarios").select("id, post_id, autor_id, texto, criado_em").in("post_id", ids).order("criado_em"),
    supabase.from("curtidas").select("post_id, usuario_id").in("post_id", ids),
  ]);

  // Bucket privado: cada foto sai com URL assinada de validade curta (1 hora).
  const caminhos = (midias ?? []).map((m) => m.storage_path as string);
  const { data: urls } = caminhos.length
    ? await supabase.storage.from("obra-fotos").createSignedUrls(caminhos, 3600)
    : { data: [] };
  const urlPorCaminho = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));

  // A regra do banco esconde a equipe do cliente. Aqui só saem nome e papel de quem assina
  // publicações e comentários que a sessão dele já conseguiu ler acima.
  const autores = [...new Set([...(posts ?? []).map((p) => p.autor_id), ...(comentarios ?? []).map((c) => c.autor_id)].filter(Boolean))];
  const { data: perfis } = await createAdminClient().from("perfis").select("id, nome, papel").in("id", autores);
  const perfil = new Map((perfis ?? []).map((p) => [p.id as string, p]));
  const etapa = new Map((etapas ?? []).map((e) => [e.id as string, e.nome as string]));

  const lista: Post[] = (posts ?? []).map((p) => ({
    id: p.id,
    tipo: p.tipo,
    autor: perfil.get(p.autor_id)?.nome ?? "Equipe da obra",
    etapa: p.etapa_id ? (etapa.get(p.etapa_id) ?? null) : null,
    titulo: p.titulo,
    texto: p.texto,
    publicado_em: p.publicado_em,
    fotos: (midias ?? []).flatMap((m) => {
      const url = m.post_id === p.id ? urlPorCaminho.get(m.storage_path) : null;
      return url ? [{ id: m.id as string, url, legenda: m.legenda as string | null }] : [];
    }),
    comentarios: (comentarios ?? [])
      .filter((c) => c.post_id === p.id)
      .map((c) => {
        const autor = perfil.get(c.autor_id);
        return {
          id: c.id,
          autor_id: c.autor_id,
          autor: autor?.nome ?? (c.autor_id === usuarioId ? "Você" : "Equipe da obra"),
          texto: c.texto,
          criado_em: c.criado_em,
          da_equipe: autor ? autor.papel !== "cliente" : true,
        };
      }),
    curtidas: (curtidas ?? []).filter((c) => c.post_id === p.id).length,
    curti: (curtidas ?? []).some((c) => c.post_id === p.id && c.usuario_id === usuarioId),
  }));

  const filtrada = lista.filter((p) => {
    if (filtro === "marcos") return p.tipo === "marco";
    if (filtro === "fotos") return p.fotos.length > 0;
    if (filtro === "comentarios") return p.comentarios.length > 0;
    return true;
  });
  return { posts: filtrada, total: total ?? 0 };
}
