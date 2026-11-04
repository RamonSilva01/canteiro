import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { carregarObra, contarPendentes } from "@/lib/obra";
import { fotosRecentes } from "@/lib/fotos";
import { dataBR } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { NavObra } from "@/components/NavObra";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { EnviarFotos } from "./EnviarFotos";
import { removerFoto } from "./actions";

export const dynamic = "force-dynamic";

export default async function FotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, perfil } = await exigirPerfil();
  const obra = await carregarObra(supabase, id);
  const equipe = ehEquipe(perfil);

  const [{ data: etapas }, fotos, pendentes] = await Promise.all([
    supabase.from("etapas").select("id, nome").eq("obra_id", id).order("ordem"),
    fotosRecentes(supabase, id),
    equipe ? contarPendentes(supabase, id) : 0,
  ]);

  // Galeria agrupada por etapa, na ordem das etapas; fotos sem etapa vão por último.
  const grupos = [...(etapas ?? []), { id: null, nome: "Geral" }]
    .map((e) => ({ ...e, fotos: fotos.filter((f) => f.etapa_id === e.id) }))
    .filter((g) => g.fotos.length > 0);

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <NavObra obraId={id} nome={obra.nome} atual="fotos" equipe={equipe} pendentes={pendentes} />

        {equipe && (
          <section className="bg-white rounded-xl shadow-sm p-5 flex flex-col gap-3">
            <h2 className="font-semibold">Publicar fotos</h2>
            <EnviarFotos empresaId={obra.empresa_id} obraId={id} etapas={(etapas ?? []) as { id: string; nome: string }[]} />
          </section>
        )}

        {grupos.length === 0 && <p className="text-stone-600">Nenhuma foto ainda.</p>}

        {grupos.map((g) => (
          <section key={g.id ?? "geral"} className="flex flex-col gap-2">
            <h2 className="font-semibold">{g.nome}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {g.fotos.map((f) => (
                <figure key={f.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.legenda ?? "Foto da obra"} className="aspect-square object-cover w-full" />
                  </a>
                  <figcaption className="px-3 py-2 text-xs text-stone-600 flex justify-between gap-2">
                    <span>
                      {dataBR(f.publicado_em)}
                      {f.legenda && ` · ${f.legenda}`}
                    </span>
                    {equipe && (
                      <form action={removerFoto.bind(null, id, f.post_id)}>
                        <BotaoConfirmar pergunta="Remover esta foto? Ela some da galeria do cliente." className="text-red-600 underline">
                          Remover
                        </BotaoConfirmar>
                      </form>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
