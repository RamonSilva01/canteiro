import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buscarLancamentos } from "@/lib/obra";
import { dataBR } from "@/lib/format";

// CSV que o Excel brasileiro abre direto: ";" como separador, vírgula decimal e BOM UTF-8
// (sem o BOM os acentos quebram). Colunas na ordem da aba Lançamentos da planilha.
const celula = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const decimal = (v: number | null | undefined, casas = 2) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: obra } = await supabase.from("obras").select("nome").eq("id", id).maybeSingle();
  if (!obra) return new NextResponse("Não encontrado", { status: 404 });

  const filtros = Object.fromEntries(req.nextUrl.searchParams);
  const [{ lista }, { data: etapas }, { data: subetapas }] = await Promise.all([
    buscarLancamentos(supabase, id, filtros),
    supabase.from("etapas").select("id, nome").eq("obra_id", id),
    supabase.from("subetapas").select("id, nome").eq("obra_id", id),
  ]);
  const etapa = new Map((etapas ?? []).map((e) => [e.id, e.nome]));
  const sub = new Map((subetapas ?? []).map((s) => [s.id, s.nome]));

  const linhas = [
    ["Data", "NF", "Especificação", "Fornecedor", "Etapa", "Subetapa", "Unidade", "Quantidade", "Valor unitário", "Valor total"],
    ...lista
      .filter((l) => l.status === "confirmado")
      .map((l) => [
        dataBR(l.data_competencia),
        l.numero_documento,
        l.descricao,
        l.fornecedor_nome,
        l.etapa_id ? etapa.get(l.etapa_id) : "",
        l.subetapa_id ? sub.get(l.subetapa_id) : "",
        l.unidade,
        decimal(l.quantidade, 2),
        decimal(l.valor_unitario, 2),
        decimal(l.valor_total, 2),
      ]),
  ];
  const corpo = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
  const arquivo = `lancamentos-${obra.nome.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}.csv`;

  return new NextResponse(corpo, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${arquivo}"`,
    },
  });
}
