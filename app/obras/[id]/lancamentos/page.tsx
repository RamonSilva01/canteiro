import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { dataBR, hojeSP, reais } from "@/lib/format";
import { buscarLancamentos, carregarObra, contarPendentes } from "@/lib/obra";
import { Cabecalho } from "@/components/Cabecalho";
import { FaixaPrevia, NavObra } from "@/components/NavObra";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { Campo, inputPequeno } from "@/components/Campo";
import { excluirLancamento, lancarManual } from "./actions";

export const dynamic = "force-dynamic";

const COMPONENTE: Record<string, string> = {
  frete: "Frete",
  desconto: "Desconto",
  seguro: "Seguro",
  ipi: "IPI",
  icms_st: "ICMS-ST",
  outras_despesas: "Outras despesas",
  ajuste: "Ajuste",
};

export default async function LancamentosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, perfil } = await exigirPerfil();

  const obra = await carregarObra(supabase, id);
  const previa = sp.ver === "cliente" && ehEquipe(perfil);
  const equipe = ehEquipe(perfil) && !previa;

  const [{ data: etapas }, { data: subetapas }, { lista: lancamentos, filtrando }, pendentes] = await Promise.all([
    supabase.from("etapas").select("id, nome").eq("obra_id", id).order("ordem"),
    supabase.from("subetapas").select("id, etapa_id, nome").eq("obra_id", id).order("ordem"),
    buscarLancamentos(supabase, id, sp),
    equipe ? contarPendentes(supabase, id) : 0,
  ]);
  const nomeEtapa = new Map((etapas ?? []).map((e) => [e.id as string, e.nome as string]));
  const nomeSub = new Map((subetapas ?? []).map((s) => [s.id as string, s.nome as string]));

  // Pendentes ficam na aba Conferir; aqui só o que já vale.
  const confirmados = lancamentos.filter((l) => l.status === "confirmado");
  const totalConfirmado = confirmados.reduce((t, l) => t + Number(l.valor_total), 0);
  const fornecedores = [...new Set(lancamentos.map((l) => l.fornecedor_nome).filter(Boolean))].sort();
  const csv = `/obras/${id}/lancamentos/csv?${new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => ["f_etapa", "de", "ate", "q", "ordem"].includes(k) && v) as [string, string][],
  )}`;

  return (
    <>
      {previa && <FaixaPrevia obraId={id} />}
      <Cabecalho perfil={perfil} />
      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <NavObra obraId={id} nome={obra.nome} atual="lancamentos" equipe={equipe} previa={previa} pendentes={pendentes} />

        {sp.erro && <p className="bg-red-50 text-red-700 text-sm rounded-md px-4 py-2">{sp.erro}</p>}
        {sp.ok && <p className="bg-emerald-50 text-emerald-800 text-sm rounded-md px-4 py-2">Lançamento salvo.</p>}

        {equipe && (
          <details className="bg-white rounded-xl shadow-sm p-5" open={!!sp.ok || !!sp.erro}>
            <summary className="font-semibold cursor-pointer">Lançamento manual</summary>
            <form action={lancarManual.bind(null, id)} className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Campo rotulo="Data" name="data_competencia" type="date" required defaultValue={sp.data || hojeSP()} />
              <Campo rotulo="Nº documento (NF, recibo)" name="numero_documento" />
              <div className="col-span-2">
                <Campo rotulo="Fornecedor" name="fornecedor_nome" list="fornecedores" defaultValue={sp.forn ?? ""} />
                <datalist id="fornecedores">
                  {fornecedores.map((f) => (
                    <option key={f} value={f!} />
                  ))}
                </datalist>
              </div>
              <div className="col-span-2 md:col-span-4">
                <Campo rotulo="Especificação" name="descricao" required />
              </div>
              <label className="col-span-2 flex flex-col gap-1 text-sm text-stone-700">
                Etapa
                <select
                  name="etapa_id"
                  required
                  defaultValue={sp.etapa ?? ""}
                  className="border border-stone-300 rounded-md px-3 py-2 bg-white"
                >
                  <option value="" disabled>
                    Escolha
                  </option>
                  {(etapas ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-2">
                <Campo rotulo="Subetapa (opcional, pode digitar nova)" name="subetapa" list="subetapas" />
                <datalist id="subetapas">
                  {[...new Set((subetapas ?? []).map((s) => s.nome as string))].map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <Campo rotulo="Unidade" name="unidade" placeholder="un, m³, kg" />
              <Campo rotulo="Quantidade" name="quantidade" inputMode="decimal" />
              <Campo rotulo="Valor unitário (R$)" name="valor_unitario" inputMode="decimal" />
              <Campo rotulo="Valor total (R$)" name="valor_total" inputMode="decimal" placeholder="vazio = qtd × unitário" />
              <button
                type="submit"
                className="col-span-2 md:col-span-4 bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700"
              >
                Salvar lançamento
              </button>
            </form>
          </details>
        )}

        <form className="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-[1fr_12rem_9rem_9rem_8rem_auto] gap-2 items-end text-sm">
          <label className="col-span-2 md:col-span-1 flex flex-col gap-1">
            Buscar
            <input name="q" defaultValue={sp.q ?? ""} placeholder="especificação ou fornecedor" className={inputPequeno} />
          </label>
          <label className="col-span-2 md:col-span-1 flex flex-col gap-1">
            Etapa
            <select name="f_etapa" defaultValue={sp.f_etapa ?? ""} className={inputPequeno}>
              <option value="">Todas</option>
              {(etapas ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            De
            <input name="de" type="date" defaultValue={sp.de ?? ""} className={inputPequeno} />
          </label>
          <label className="flex flex-col gap-1">
            Até
            <input name="ate" type="date" defaultValue={sp.ate ?? ""} className={inputPequeno} />
          </label>
          <label className="flex flex-col gap-1">
            Ordenar
            <select name="ordem" defaultValue={sp.ordem ?? ""} className={inputPequeno}>
              <option value="">Mais recente</option>
              <option value="valor">Maior valor</option>
            </select>
          </label>
          <button type="submit" className="border border-stone-300 rounded-md px-3 py-1">
            Filtrar
          </button>
        </form>

        <section className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <div className="px-4 py-3 flex justify-between text-sm border-b border-stone-200">
            <span>
              {confirmados.length} lançamento(s){filtrando && " no filtro"} ·{" "}
              <a href={csv} className="underline">
                Exportar CSV
              </a>
            </span>
            <span className="font-semibold num">Total {reais(totalConfirmado)}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {confirmados.map((l) => (
                <tr key={l.id} className="border-b border-stone-100">
                  <td className="px-4 py-3 whitespace-nowrap text-stone-500 align-top">{dataBR(l.data_competencia)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {COMPONENTE[l.componente] && (
                        <span className="mr-2 text-xs bg-stone-200 rounded px-1.5 py-0.5">{COMPONENTE[l.componente]}</span>
                      )}
                      {l.descricao}
                    </div>
                    <div className="text-xs text-stone-500">
                      {[
                        l.fornecedor_nome,
                        l.numero_documento && `doc. ${l.numero_documento}`,
                        [l.etapa_id && nomeEtapa.get(l.etapa_id), l.subetapa_id && nomeSub.get(l.subetapa_id)]
                          .filter(Boolean)
                          .join(" / "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right num whitespace-nowrap align-top">{reais(l.valor_total)}</td>
                  {equipe && (
                    <td className="px-4 py-3 text-right align-top">
                      <form action={excluirLancamento.bind(null, id, l.id)}>
                        <BotaoConfirmar
                          pergunta={`Excluir "${l.descricao}" (${reais(l.valor_total)})? Ele sai do acompanhamento e da visão do cliente.`}
                          className="text-xs text-red-600 underline"
                        >
                          Excluir
                        </BotaoConfirmar>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {confirmados.length === 0 && <p className="px-4 py-6 text-sm text-stone-500">Nenhum lançamento.</p>}
        </section>
      </main>
    </>
  );
}
