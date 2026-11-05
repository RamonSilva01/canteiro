"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { hojeSP, numero, texto } from "@/lib/format";
import { traduzir } from "@/lib/erros";

function voltar(obraId: string, erro?: { message: string } | null, extra = ""): never {
  revalidatePath(`/obras/${obraId}`);
  redirect(`/obras/${obraId}${erro ? `?erro=${encodeURIComponent(traduzir(erro.message))}` : extra}`);
}

export async function salvarEtapas(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") voltar(obraId);

  const ids = fd.getAll("id").map(String);
  const resultados = await Promise.all(
    ids.map((id) =>
      supabase
        .from("etapas")
        .update({
          nome: texto(fd.get(`nome_${id}`)),
          orcamento_referencia: numero(fd.get(`orc_${id}`)) ?? 0,
          data_inicio_prevista: texto(fd.get(`ini_${id}`)),
          data_fim_prevista: texto(fd.get(`fim_${id}`)),
        })
        .eq("id", id)
        .eq("obra_id", obraId),
    ),
  );
  voltar(obraId, resultados.find((r) => r.error)?.error, "?editar=1&etapas_salvas=1");
}

// Chamada ao soltar uma etapa arrastada: grava a posição de todas, sem mexer nos outros campos.
export async function reordenarEtapas(obraId: string, ids: string[]): Promise<{ erro?: string }> {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") return { erro: "Só o administrador muda a ordem das etapas." };

  const resultados = await Promise.all(
    ids.map((id, i) => supabase.from("etapas").update({ ordem: i + 1 }).eq("id", id).eq("obra_id", obraId)),
  );
  const erro = resultados.find((r) => r.error)?.error;
  if (erro) return { erro: traduzir(erro.message) };
  revalidatePath(`/obras/${obraId}`, "layout");
  return {};
}

export async function adicionarEtapa(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") voltar(obraId);

  const { data: ultima } = await supabase
    .from("etapas")
    .select("ordem")
    .eq("obra_id", obraId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("etapas")
    .insert({ obra_id: obraId, nome: texto(fd.get("nome")), ordem: (ultima?.ordem ?? 0) + 1 });
  voltar(obraId, error, "?editar=1");
}

export async function removerEtapa(obraId: string, etapaId: string) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") voltar(obraId);

  const { error } = await supabase.from("etapas").delete().eq("id", etapaId).eq("obra_id", obraId);
  voltar(obraId, error, "?editar=1");
}

// Um registro por etapa por dia: reenvio no mesmo dia corrige o do dia (histórico fica no banco).
export async function registrarAvanco(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) voltar(obraId);

  const { data: etapas } = await supabase.from("etapas").select("id, percentual_avanco").eq("obra_id", obraId);
  const hoje = hojeSP();
  const linhas = (etapas ?? []).flatMap((e) => {
    const v = numero(fd.get(`av_${e.id}`));
    if (v == null || v === Number(e.percentual_avanco)) return [];
    return [
      {
        obra_id: obraId,
        etapa_id: e.id,
        percentual: Math.min(100, Math.max(0, Math.round(v * 10) / 10)),
        data_referencia: hoje,
        registrado_por: perfil.id,
      },
    ];
  });

  if (linhas.length) {
    const { error } = await supabase.from("avancos_etapa").upsert(linhas, { onConflict: "etapa_id,data_referencia" });
    if (error) voltar(obraId, error);
  }
  voltar(obraId, null, linhas.length ? "?salvo=avanco" : "");
}
