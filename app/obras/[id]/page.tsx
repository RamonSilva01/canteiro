import Link from "next/link";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { carregarObra, contarPendentes } from "@/lib/obra";
import { NavObra } from "@/components/NavObra";
import { PortalCliente } from "./PortalCliente";
import { dataBR, pct, reais } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { Kpi } from "@/components/Kpi";
import { inputPequeno } from "@/components/Campo";
import { BarraDupla, Economia, Situacao } from "@/components/Situacao";
import { EditorEtapas } from "./EditorEtapas";
import { adicionarEtapa, registrarAvanco } from "./actions";

export const dynamic = "force-dynamic";

type Etapa = {
  etapa_id: string;
  nome: string;
  ordem: number;
  orcamento_referencia: number;
  percentual_avanco: number;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  custo_real: number;
  custo_projetado: number;
  economia: number;
  avanco_esperado: number | null;
  situacao_prazo: string;
  fases: { inicio: string; fim: string }[] | null;
  obra_toda: boolean;
};

export default async function ObraPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; editar?: string; salvo?: string; etapas_salvas?: string; ver?: string }>;
}) {
  const { id } = await params;
  const { erro, editar, salvo, etapas_salvas, ver } = await searchParams;
  const { supabase, perfil } = await exigirPerfil();

  const obra = await carregarObra(supabase, id);
  if (perfil.papel === "cliente" || ver === "cliente") {
    return <PortalCliente supabase={supabase} obra={obra} perfil={perfil} previa={perfil.papel !== "cliente"} />;
  }

  const [{ data: resumo }, { data: etapasData }, { data: subetapas }, pendentes] = await Promise.all([
    supabase.from("vw_obras_consolidadas").select("*").eq("id", id).maybeSingle(),
    supabase.from("vw_etapas_consolidadas").select("*").eq("obra_id", id).order("ordem"),
    supabase.from("subetapas").select("etapa_id, nome").eq("obra_id", id).order("ordem"),
    contarPendentes(supabase, id),
  ]);
  const etapas = (etapasData ?? []) as Etapa[];
  const subPorEtapa = new Map<string, string[]>();
  for (const s of subetapas ?? []) subPorEtapa.set(s.etapa_id, [...(subPorEtapa.get(s.etapa_id) ?? []), s.nome]);

  const admin = perfil.papel === "admin";
  const equipe = ehEquipe(perfil);
  const total = (k: keyof Etapa) => etapas.reduce((t, e) => t + Number(e[k] ?? 0), 0);
  const orcTotal = total("orcamento_referencia");

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <NavObra obraId={id} nome={obra.nome} atual="acompanhamento" equipe={equipe} pendentes={pendentes}>
          <Situacao valor={resumo?.situacao_prazo ?? null} />
          <span className="flex-1" />
          <Link href={`/obras/${id}?ver=cliente`} className="btn btn-ghost btn-sm">
            Ver como cliente
          </Link>
          {admin && (
            <Link href={`/obras/${id}/relatorio`} className="btn btn-primary btn-sm">
              Gerar relatório PDF
            </Link>
          )}
        </NavObra>
        <p className="-mt-4 text-sm text-stone-500">
          {[obra.cliente_nome, [obra.endereco_cidade, obra.endereco_uf].filter(Boolean).join("/")]
            .filter(Boolean)
            .join(" · ")}
          {" · "}início {dataBR(obra.data_inicio)} · entrega prevista {dataBR(obra.data_entrega_prevista)}
        </p>
        {pendentes > 0 && (
          <Link href={`/obras/${id}/conferir`} className="bg-amber-50 text-amber-900 text-sm rounded-md px-4 py-2 underline">
            {pendentes} lançamento(s) aguardando conferência
          </Link>
        )}

        {erro && <p className="bg-red-50 text-red-700 text-sm rounded-md px-4 py-2">{erro}</p>}
        {salvo && <p className="bg-emerald-50 text-emerald-800 text-sm rounded-md px-4 py-2">Avanço salvo.</p>}
        {etapas_salvas && <p className="bg-emerald-50 text-emerald-800 text-sm rounded-md px-4 py-2">Etapas salvas.</p>}

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl shadow-sm p-4 col-span-2 md:col-span-1 flex flex-col gap-2">
            <p className="text-xs text-stone-500">Avanço geral</p>
            <p className="text-lg font-semibold num">{pct(resumo?.avanco_geral ?? 0)}</p>
            <BarraDupla
              real={Number(resumo?.avanco_geral ?? 0)}
              esperado={resumo?.avanco_esperado == null ? null : Number(resumo.avanco_esperado)}
            />
            <p className="text-xs text-stone-500">esperado hoje {pct(resumo?.avanco_esperado)}</p>
          </div>
          <Kpi rotulo="Orçamento" valor={reais(orcTotal)} />
          <Kpi rotulo="Custo projetado" valor={reais(total("custo_projetado"))} />
          <Kpi rotulo="Custo real" valor={reais(total("custo_real"))} />
          <Kpi rotulo="Econômetro" valor={<Economia valor={total("economia")} />} />
        </section>

        <section className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500 border-b border-stone-200">
              <tr>
                <th className="px-4 py-3 font-medium">Etapa</th>
                <th className="px-4 py-3 font-medium">Prazo</th>
                <th className="px-4 py-3 font-medium text-right">Avanço</th>
                <th className="px-4 py-3 font-medium text-right">Orçamento</th>
                <th className="px-4 py-3 font-medium text-right">Projetado</th>
                <th className="px-4 py-3 font-medium text-right">Real</th>
                <th className="px-4 py-3 font-medium text-right">Economia</th>
                <th className="px-4 py-3 font-medium text-right">Real ÷ orç.</th>
              </tr>
            </thead>
            <tbody>
              {etapas.map((e) => (
                <tr key={e.etapa_id} className="border-b border-stone-100">
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.nome}</div>
                    {subPorEtapa.get(e.etapa_id) && (
                      <div className="text-xs text-stone-500">{subPorEtapa.get(e.etapa_id)!.join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-stone-500">
                      {e.obra_toda && <div>obra toda</div>}
                      {e.data_inicio_prevista
                        ? (e.fases?.length && !e.obra_toda ? e.fases : [{ inicio: e.data_inicio_prevista, fim: e.data_fim_prevista }]).map((f, i, todas) => (
                            <div key={i}>
                              {todas.length > 1 && `${i + 1}ª fase: `}
                              {dataBR(f.inicio)} a {dataBR(f.fim)}
                            </div>
                          ))
                        : e.obra_toda ? "faltam as datas da obra" : "sem datas"}
                    </div>
                    {e.situacao_prazo !== "sem_prazo" && <Situacao valor={e.situacao_prazo} />}
                  </td>
                  <td className="px-4 py-3 text-right num whitespace-nowrap">
                    {pct(e.percentual_avanco)}
                    {e.avanco_esperado != null && (
                      <div className="text-xs text-stone-500">esp. {pct(e.avanco_esperado)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right num">{reais(e.orcamento_referencia)}</td>
                  <td className="px-4 py-3 text-right num">{reais(e.custo_projetado)}</td>
                  <td className="px-4 py-3 text-right num">{reais(e.custo_real)}</td>
                  <td className="px-4 py-3 text-right">
                    <Economia valor={Number(e.economia)} />
                  </td>
                  <td className="px-4 py-3 text-right num">
                    {Number(e.orcamento_referencia) > 0
                      ? pct((100 * Number(e.custo_real)) / Number(e.orcamento_referencia))
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-semibold">
              <tr>
                <td className="px-4 py-3" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-3 text-right num">{reais(orcTotal)}</td>
                <td className="px-4 py-3 text-right num">{reais(total("custo_projetado"))}</td>
                <td className="px-4 py-3 text-right num">{reais(total("custo_real"))}</td>
                <td className="px-4 py-3 text-right">
                  <Economia valor={total("economia")} />
                </td>
                <td className="px-4 py-3 text-right num">
                  {orcTotal > 0 ? pct((100 * total("custo_real")) / orcTotal) : "-"}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {equipe && etapas.length > 0 && (
          <details className="bg-white rounded-xl shadow-sm p-5" open={!editar}>
            <summary className="font-semibold cursor-pointer">Atualizar avanço físico</summary>
            <form action={registrarAvanco.bind(null, id)} className="mt-4 flex flex-col gap-3">
              {etapas.map((e) => (
                <label key={e.etapa_id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{e.nome}</span>
                  <span className="flex items-center gap-1">
                    <input
                      name={`av_${e.etapa_id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.1}
                      defaultValue={Number(e.percentual_avanco)}
                      className={`${inputPequeno} w-24 text-right num`}
                    />
                    %
                  </span>
                </label>
              ))}
              <button type="submit" className="self-end bg-stone-900 text-white rounded-md px-4 py-2 hover:bg-stone-700">
                Salvar avanço
              </button>
            </form>
          </details>
        )}

        {equipe && (
          <details className="bg-white rounded-xl shadow-sm p-5" open={!!editar}>
            <summary className="font-semibold cursor-pointer">Editar etapas, orçamento e datas previstas</summary>
            <p className="mt-2 text-sm text-stone-500">
              As datas previstas definem o &quot;esperado para hoje&quot; de cada etapa e o status da obra. Etapa que volta em
              momentos diferentes (hidráulica no início, no meio e no fim) ganha uma fase para cada momento em &quot;+ fase&quot;:
              entre uma fase e outra o esperado fica parado. Mão de obra e locação: marque &quot;obra toda&quot;.
            </p>
            <EditorEtapas obraId={id} etapas={etapas} />
            <form action={adicionarEtapa.bind(null, id)} className="mt-4 flex gap-2">
              <input name="nome" required placeholder="Nova etapa" className={inputPequeno} />
              <button type="submit" className="whitespace-nowrap border border-stone-300 rounded-md px-3 text-sm">
                Adicionar
              </button>
            </form>
          </details>
        )}
      </main>
    </>
  );
}
