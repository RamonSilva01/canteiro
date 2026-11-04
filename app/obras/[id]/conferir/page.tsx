import Link from "next/link";
import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { carregarObra } from "@/lib/obra";
import { dataBR, reais } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { NavObra } from "@/components/NavObra";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { confirmarLancamentos, descartarLancamento } from "./actions";

export const dynamic = "force-dynamic";

type Pendente = {
  id: string;
  nota_fiscal_id: string | null;
  componente: string;
  data_competencia: string;
  descricao: string;
  fornecedor_nome: string | null;
  numero_documento: string | null;
  quantidade: number | null;
  unidade: string | null;
  valor_total: number;
  sugestao_etapa_id: string | null;
  sugestao_subetapa_id: string | null;
  sugestao_origem: string;
  sugestao_confianca: number | null;
  sugestao_justificativa: string | null;
};

const ORIGEM: Record<string, string> = { historico: "histórico", regra: "regra", ia: "IA" };

export default async function ConferirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; confirmados?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(`/obras/${id}`);
  const obra = await carregarObra(supabase, id);

  const [{ data }, { data: etapas }, { data: subetapas }, { data: notas }] = await Promise.all([
    supabase
      .from("lancamentos")
      .select(
        "id, nota_fiscal_id, componente, data_competencia, descricao, fornecedor_nome, numero_documento, quantidade, unidade, valor_total, sugestao_etapa_id, sugestao_subetapa_id, sugestao_origem, sugestao_confianca, sugestao_justificativa",
      )
      .eq("obra_id", id)
      .eq("status", "pendente")
      .is("excluido_em", null)
      .order("criado_em")
      .order("item_numero"),
    supabase.from("etapas").select("id, nome").eq("obra_id", id).order("ordem"),
    supabase.from("subetapas").select("id, etapa_id, nome").eq("obra_id", id).order("ordem"),
    supabase.from("vw_notas_conferencia").select("nota_fiscal_id, valor_nota, diferenca").eq("obra_id", id),
  ]);
  const pendentes = (data ?? []) as Pendente[];
  const notaInfo = new Map((notas ?? []).map((n) => [n.nota_fiscal_id as string, n]));

  // Agrupa por nota, mantendo a ordem de chegada
  const grupos = new Map<string, Pendente[]>();
  for (const l of pendentes) {
    const chave = l.nota_fiscal_id ?? "avulsos";
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }

  // Opções de classificação: etapa, ou etapa › subetapa
  const opcoes = (etapas ?? []).flatMap((e) => [
    { valor: `${e.id}|`, rotulo: e.nome as string },
    ...(subetapas ?? [])
      .filter((s) => s.etapa_id === e.id)
      .map((s) => ({ valor: `${e.id}|${s.id}`, rotulo: `${e.nome} › ${s.nome}` })),
  ]);

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
        <NavObra obraId={id} nome={obra.nome} atual="conferir" equipe pendentes={pendentes.length} />

        {sp.confirmados && Number(sp.confirmados) > 0 && (
          <p className="bg-emerald-50 text-emerald-800 text-sm rounded-md px-4 py-2">
            {sp.confirmados} lançamento(s) confirmado(s). Já aparecem no acompanhamento e para o cliente.
          </p>
        )}
        {sp.erro && <p className="bg-red-50 text-red-700 text-sm rounded-md px-4 py-2">{sp.erro}</p>}

        {pendentes.length === 0 ? (
          <p className="text-stone-600">
            Nada aguardando conferência.{" "}
            <Link href={`/obras/${id}/importar`} className="underline">
              Importar notas
            </Link>
          </p>
        ) : (
          <form action={confirmarLancamentos.bind(null, id)} className="flex flex-col gap-4">
            {[...grupos.entries()].map(([chave, linhas]) => {
              const info = notaInfo.get(chave);
              const primeira = linhas[0];
              return (
                <section key={chave} className="bg-white rounded-xl shadow-sm overflow-x-auto">
                  <div className="px-4 py-3 border-b border-stone-200 flex flex-wrap justify-between gap-2 text-sm">
                    <div>
                      <span className="font-semibold">{primeira.fornecedor_nome ?? "Fornecedor não identificado"}</span>
                      <span className="text-stone-500">
                        {" "}
                        · NF {primeira.numero_documento ?? "s/n"} · {dataBR(primeira.data_competencia)}
                      </span>
                    </div>
                    {info && (
                      <div className="num">
                        Total da nota {reais(info.valor_nota)}
                        {Number(info.diferenca) !== 0 && (
                          <span className="ml-2 text-red-600">diferença {reais(info.diferenca)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {linhas.map((l) => {
                        const sugestao = l.sugestao_etapa_id ? `${l.sugestao_etapa_id}|${l.sugestao_subetapa_id ?? ""}` : "";
                        return (
                          <tr key={l.id} className="border-b border-stone-100">
                            <td className="px-4 py-3 w-8 align-top">
                              <input type="checkbox" name="ok" value={l.id} defaultChecked aria-label="Confirmar" />
                            </td>
                            <td className="px-2 py-3 align-top">
                              <div className="font-medium">{l.descricao}</div>
                              <div className="text-xs text-stone-500">
                                {l.quantidade != null && `${Number(l.quantidade).toLocaleString("pt-BR")} ${l.unidade ?? ""}`}
                                {l.sugestao_etapa_id && l.sugestao_justificativa && (
                                  <span className={l.quantidade != null ? "ml-2" : ""}>
                                    Sugestão por {ORIGEM[l.sugestao_origem] ?? l.sugestao_origem}: {l.sugestao_justificativa}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-3 align-top min-w-56">
                              <select
                                name={`c_${l.id}`}
                                defaultValue={sugestao}
                                className={`border rounded-md px-2 py-1 w-full bg-white ${
                                  sugestao && Number(l.sugestao_confianca ?? 0) < 0.7 ? "border-amber-400" : "border-stone-300"
                                }`}
                              >
                                <option value="">Escolha a etapa</option>
                                {opcoes.map((o) => (
                                  <option key={o.valor} value={o.valor}>
                                    {o.rotulo}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-3 text-right num whitespace-nowrap align-top">{reais(l.valor_total)}</td>
                            <td className="px-4 py-3 text-right align-top">
                              <BotaoConfirmar
                                pergunta={`Descartar "${l.descricao}" (${reais(l.valor_total)})? Ele não entra nos custos da obra.`}
                                formAction={descartarLancamento.bind(null, id, l.id)}
                                formNoValidate
                                className="text-xs text-red-600 underline"
                              >
                                Descartar
                              </BotaoConfirmar>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}
            <p className="text-sm text-stone-500">
              Linhas marcadas e com etapa são confirmadas. Borda amarela indica sugestão de confiança baixa: vale olhar.
            </p>
            <button type="submit" className="self-end bg-stone-900 text-white rounded-md px-5 py-2 font-medium hover:bg-stone-700">
              Confirmar marcados
            </button>
          </form>
        )}
      </main>
    </>
  );
}
