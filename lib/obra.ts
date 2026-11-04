import "server-only";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Obra visível ao usuário (RLS) ou 404, sem revelar se ela existe. */
export async function carregarObra(supabase: SupabaseClient, id: string) {
  const { data: obra } = await supabase
    .from("obras")
    .select("id, empresa_id, nome, cliente_nome, endereco_cidade, endereco_uf, data_inicio, data_entrega_prevista, capa_path")
    .eq("id", id)
    .maybeSingle();
  if (!obra) notFound();
  return obra;
}

export type Lancamento = {
  id: string;
  data_competencia: string;
  numero_documento: string | null;
  descricao: string;
  fornecedor_nome: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number;
  status: "pendente" | "confirmado";
  componente: string;
  etapa_id: string | null;
  subetapa_id: string | null;
};

export type Filtros = { f_etapa?: string; de?: string; ate?: string; q?: string; ordem?: string };

/** Lançamentos não excluídos com os filtros da tela, paginando além do teto de 1000 linhas da API. */
export async function buscarLancamentos(supabase: SupabaseClient, obraId: string, f: Filtros) {
  const busca = (f.q ?? "").replace(/[,()%*\\]/g, " ").trim();
  const lista: Lancamento[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase
      .from("lancamentos")
      .select(
        "id, data_competencia, numero_documento, descricao, fornecedor_nome, unidade, quantidade, valor_unitario, valor_total, status, componente, etapa_id, subetapa_id",
      )
      .eq("obra_id", obraId)
      .is("excluido_em", null)
      .order("data_competencia", { ascending: false })
      .order("criado_em", { ascending: false })
      .range(de, de + 999);
    if (f.f_etapa) q = q.eq("etapa_id", f.f_etapa);
    if (f.de) q = q.gte("data_competencia", f.de);
    if (f.ate) q = q.lte("data_competencia", f.ate);
    if (busca) q = q.or(`descricao.ilike.*${busca}*,fornecedor_nome.ilike.*${busca}*`);
    const { data } = await q;
    lista.push(...((data ?? []) as Lancamento[]));
    if (!data || data.length < 1000) break;
  }
  if (f.ordem === "valor") lista.sort((a, b) => Number(b.valor_total) - Number(a.valor_total));
  return { lista, filtrando: Boolean(f.f_etapa || f.de || f.ate || busca) };
}

/** Quantos lançamentos aguardam conferência (só a equipe enxerga pendentes). */
export async function contarPendentes(supabase: SupabaseClient, obraId: string) {
  const { count } = await supabase
    .from("lancamentos")
    .select("id", { count: "exact", head: true })
    .eq("obra_id", obraId)
    .eq("status", "pendente")
    .is("excluido_em", null);
  return count ?? 0;
}
