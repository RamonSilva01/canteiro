import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Números do portal do cliente e do PDF mensal: uma fonte só, para os dois nunca divergirem.

export type EtapaResumo = {
  etapa_id: string;
  nome: string;
  percentual_avanco: number;
  custo_real: number;
  custo_projetado: number;
  data_fim_real: string | null;
};

export type DadosRelatorio = {
  obra: { nome: string; cliente_nome: string | null; data_inicio: string | null; data_entrega_prevista: string | null };
  gerado_em: string;
  situacao: string;
  avanco_geral: number;
  avanco_esperado: number | null;
  diferenca_pontos: number | null;
  economia: number;
  custo_obra: { projetado: number; gasto: number };
  mao_de_obra: { projetado: number; gasto: number };
  etapas: EtapaResumo[];
};

type ObraBase = DadosRelatorio["obra"] & { id: string };

const ehMaoDeObra = (nome: string) =>
  nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes("mao de obra");

export async function montarDados(supabase: SupabaseClient, obra: ObraBase): Promise<DadosRelatorio> {
  const [{ data: resumo }, { data }] = await Promise.all([
    supabase.from("vw_obras_consolidadas").select("*").eq("id", obra.id).maybeSingle(),
    supabase
      .from("vw_etapas_consolidadas")
      .select("etapa_id, nome, percentual_avanco, custo_real, custo_projetado, data_fim_real")
      .eq("obra_id", obra.id)
      .order("ordem"),
  ]);
  const etapas = (data ?? []) as EtapaResumo[];
  const soma = (lista: EtapaResumo[], k: "custo_projetado" | "custo_real") =>
    lista.reduce((t, e) => t + Number(e[k] ?? 0), 0);
  const obraPropria = etapas.filter((e) => !ehMaoDeObra(e.nome));
  const maoDeObra = etapas.filter((e) => ehMaoDeObra(e.nome));
  const esperado = resumo?.avanco_esperado == null ? null : Number(resumo.avanco_esperado);

  return {
    obra: {
      nome: obra.nome,
      cliente_nome: obra.cliente_nome,
      data_inicio: obra.data_inicio,
      data_entrega_prevista: obra.data_entrega_prevista,
    },
    gerado_em: new Date().toISOString(),
    situacao: resumo?.situacao_prazo ?? "sem_prazo",
    avanco_geral: Number(resumo?.avanco_geral ?? 0),
    avanco_esperado: esperado,
    diferenca_pontos: esperado == null ? null : Number(resumo?.avanco_real_planejado ?? 0) - esperado,
    economia: Number(resumo?.economia_total ?? 0),
    custo_obra: { projetado: soma(obraPropria, "custo_projetado"), gasto: soma(obraPropria, "custo_real") },
    mao_de_obra: { projetado: soma(maoDeObra, "custo_projetado"), gasto: soma(maoDeObra, "custo_real") },
    etapas,
  };
}

/** Teto "redondo" do Econômetro (1, 2 ou 5 × 10ⁿ), com folga para o ponteiro não encostar no fim. */
export function tetoEconometro(economia: number) {
  const alvo = Math.max(Math.abs(economia) * 1.5, 1000);
  const base = 10 ** Math.floor(Math.log10(alvo));
  return ([1, 2, 5, 10].find((m) => m * base >= alvo) ?? 10) * base;
}

export const ROTULO_SITUACAO: Record<string, string> = {
  adiantada: "ADIANTADA",
  no_prazo: "NO PRAZO",
  atrasada: "ATRASADA",
  sem_prazo: "EM ANDAMENTO",
};
