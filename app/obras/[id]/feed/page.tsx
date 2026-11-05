import Link from "next/link";
import { notFound } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { carregarObra } from "@/lib/obra";
import { carregarFeed, FILTROS, type Post } from "@/lib/feed";
import { feedAtivo } from "@/lib/recursos";
import { Cabecalho } from "@/components/Cabecalho";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { FaixaPrevia } from "@/components/NavObra";
import { EnviarFotos } from "../fotos/EnviarFotos";
import { removerFoto } from "../fotos/actions";
import { alternarCurtida, comentar, publicarTexto, removerComentario } from "./actions";

export const dynamic = "force-dynamic";

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");

const quando = (d: string) =>
  new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export default async function FeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtro?: string; ver?: string }>;
}) {
  if (!feedAtivo()) notFound();
  const { id } = await params;
  const { filtro = "tudo", ver } = await searchParams;
  const { supabase, perfil } = await exigirPerfil();
  const obra = await carregarObra(supabase, id);
  const previa = ver === "cliente" && ehEquipe(perfil);
  const equipe = ehEquipe(perfil) && !previa;
  const sufixo = previa ? "ver=cliente" : "";

  const [{ posts, total }, { data: etapas }] = await Promise.all([
    carregarFeed(supabase, id, perfil.id, filtro),
    supabase.from("etapas").select("id, nome").eq("obra_id", id).order("ordem"),
  ]);

  const Artigo = ({ p }: { p: Post }) => {
    const automatico = p.tipo === "marco";
    return (
      <article className="post">
        <div className="post-head">
          <div className="av">{automatico ? "CA" : iniciais(p.autor)}</div>
          <div>
            <div className="who">{automatico ? "Canteiro" : p.autor}</div>
            <div className="when">
              {quando(p.publicado_em)}
              {automatico && " · automático"}
            </div>
          </div>
          <span className="spacer" />
          {p.etapa && !automatico && (
            <span className="pill" style={{ background: "rgba(44,111,191,.18)", color: "#8FC2FF" }}>
              {p.etapa}
            </span>
          )}
        </div>
        {p.titulo && <div className="milestone">{p.titulo}</div>}
        {p.texto && <div className="post-text">{p.texto}</div>}
        {p.fotos.map((f) => (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="post-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.legenda ?? "Foto da obra"} className="w-full h-full object-cover" />
          </a>
        ))}
        <div className="post-actions">
          {previa ? (
            <span>Curtir · {p.curtidas}</span>
          ) : (
            <form action={alternarCurtida.bind(null, id, p.id, p.curti)}>
              <button type="submit" style={p.curti ? { color: "var(--amber-400)" } : undefined}>
                {p.curti ? "Curtido" : "Curtir"} · {p.curtidas}
              </button>
            </form>
          )}
          <span>
            {p.comentarios.length === 1 ? "1 comentário" : `${p.comentarios.length} comentários`}
          </span>
          <span className="flex-1" />
          {equipe && (
            <form action={removerFoto.bind(null, id, p.id)}>
              <BotaoConfirmar pergunta="Remover esta publicação? Ela some do feed do cliente.">Remover</BotaoConfirmar>
            </form>
          )}
        </div>
        {(p.comentarios.length > 0 || !previa) && (
          <div className="comments">
            {p.comentarios.map((c) => (
              <div key={c.id} className={`comment ${c.da_equipe ? "admin" : ""}`}>
                <div className="av">{iniciais(c.autor)}</div>
                <div>
                  <div className="bubble">
                    <b>{c.autor}</b>
                    {c.texto}
                  </div>
                  <div className="when flex gap-2">
                    {quando(c.criado_em)}
                    {!previa && (c.autor_id === perfil.id || perfil.papel === "admin") && (
                      <form action={removerComentario.bind(null, id, c.id)}>
                        <BotaoConfirmar pergunta="Remover este comentário?" className="underline">
                          Remover
                        </BotaoConfirmar>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!previa && (
              <form action={comentar.bind(null, id, p.id)} className="comment-box">
                <input name="texto" required maxLength={4000} placeholder="Escreva um comentário..." aria-label="Comentário" />
                <button type="submit">Enviar</button>
              </form>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="client">
      {previa && <FaixaPrevia obraId={id} />}
      <Cabecalho perfil={previa ? { nome: obra.cliente_nome ?? "Cliente", papel: "cliente" } : perfil} />
      <nav className="tabs">
        <Link href={`/obras/${id}${sufixo ? `?${sufixo}` : ""}`}>{ehEquipe(perfil) && !previa ? "Acompanhamento" : "Minha obra"}</Link>
        <span aria-current="page">Feed da obra</span>
      </nav>
      <main className="max-w-[1180px] mx-auto px-4 py-6 pb-16">
        <div className="page-head">
          <div>
            <h1 className="font-semibold">Feed da obra</h1>
            <p className="sub">
              {obra.nome} · {total === 1 ? "1 publicação" : `${total} publicações`}
            </p>
          </div>
        </div>

        <div className="feed">
          {equipe && (
            <details className="bg-white text-stone-900 rounded-2xl p-4 mb-[18px]">
              <summary className="font-semibold cursor-pointer">Nova publicação</summary>
              <form action={publicarTexto.bind(null, id)} className="mt-3 flex flex-col gap-2">
                <textarea name="texto" required rows={3} placeholder="O que aconteceu na obra?" className="border border-stone-300 rounded-md px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <select name="etapa" className="flex-1 border border-stone-300 rounded-md px-3 py-2 bg-white text-sm">
                    <option value="">Etapa (opcional)</option>
                    {(etapas ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-primary">
                    Publicar texto
                  </button>
                </div>
              </form>
              <div className="mt-4 pt-4 border-t border-stone-200">
                <p className="text-sm font-medium mb-2">Ou publique fotos</p>
                <EnviarFotos empresaId={perfil.empresa_id} obraId={id} etapas={(etapas ?? []) as { id: string; nome: string }[]} />
              </div>
            </details>
          )}

          <div className="feed-filter">
            {FILTROS.map((f) => (
              <Link
                key={f.chave}
                href={`/obras/${id}/feed?${new URLSearchParams({ filtro: f.chave, ...(previa ? { ver: "cliente" } : {}) })}`}
                className="filtro"
                aria-pressed={filtro === f.chave}
              >
                {f.rotulo}
              </Link>
            ))}
          </div>

          {posts.length === 0 ? (
            <p className="text-sm text-[#8FAAC0]">Nenhuma publicação aqui ainda.</p>
          ) : (
            posts.map((p) => <Artigo key={p.id} p={p} />)
          )}
        </div>
      </main>
    </div>
  );
}
