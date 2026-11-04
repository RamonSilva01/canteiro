"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { numero, texto } from "@/lib/format";
import { traduzir } from "@/lib/erros";

const caminho = (obraId: string) => `/obras/${obraId}/lancamentos`;

export async function lancarManual(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(caminho(obraId));

  function falha(mensagem: string): never {
    redirect(`${caminho(obraId)}?erro=${encodeURIComponent(mensagem)}`);
  }

  const etapaId = texto(fd.get("etapa_id"));
  if (!etapaId) falha("Escolha a etapa.");

  // Subetapa digitada: usa a existente na etapa ou cria na hora (criar exige admin, pela RLS).
  let subetapaId: string | null = null;
  const subNome = texto(fd.get("subetapa"));
  if (subNome) {
    const { data: existente } = await supabase
      .from("subetapas")
      .select("id")
      .eq("etapa_id", etapaId)
      .ilike("nome", subNome.replace(/[%_\\]/g, "\\$&"))
      .maybeSingle();
    if (existente) {
      subetapaId = existente.id;
    } else {
      const { data: nova, error } = await supabase
        .from("subetapas")
        .insert({ etapa_id: etapaId, obra_id: obraId, nome: subNome })
        .select("id")
        .single();
      if (error || !nova) falha(traduzir(error?.message ?? "subetapa"));
      subetapaId = nova.id;
    }
  }

  const quantidade = numero(fd.get("quantidade"));
  const unitario = numero(fd.get("valor_unitario"));
  const valorTotal =
    numero(fd.get("valor_total")) ??
    (quantidade != null && unitario != null ? Math.round(quantidade * unitario * 100) / 100 : null);
  if (valorTotal == null) falha("Informe o valor total, ou quantidade e valor unitário.");

  const data = texto(fd.get("data_competencia"));
  const fornecedor = texto(fd.get("fornecedor_nome"));
  const { error } = await supabase.from("lancamentos").insert({
    obra_id: obraId,
    etapa_id: etapaId,
    subetapa_id: subetapaId,
    data_competencia: data,
    numero_documento: texto(fd.get("numero_documento")),
    descricao: texto(fd.get("descricao")),
    fornecedor_nome: fornecedor,
    unidade: texto(fd.get("unidade")),
    quantidade,
    valor_unitario: unitario,
    valor_total: valorTotal,
    origem: "manual",
    status: "confirmado",
    criado_por: perfil.id,
  });
  if (error) falha(traduzir(error.message));

  // Reabre limpo, mantendo data e fornecedor para lançar em sequência.
  revalidatePath(`/obras/${obraId}`, "layout");
  const manter = new URLSearchParams({ ok: "1", data: data ?? "", forn: fornecedor ?? "", etapa: etapaId ?? "" });
  redirect(`${caminho(obraId)}?${manter}`);
}

export async function excluirLancamento(obraId: string, lancamentoId: string) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(caminho(obraId));

  // Descarte lógico: some das telas e dos cálculos, mas fica no banco.
  const { error } = await supabase
    .from("lancamentos")
    .update({ excluido_em: new Date().toISOString(), excluido_por: perfil.id })
    .eq("id", lancamentoId)
    .eq("obra_id", obraId);
  revalidatePath(`/obras/${obraId}`, "layout");
  redirect(error ? `${caminho(obraId)}?erro=${encodeURIComponent(traduzir(error.message))}` : caminho(obraId));
}
