"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/sessao";
import { carregarObra } from "@/lib/obra";
import { traduzir } from "@/lib/erros";
import { createAdminClient } from "@/lib/supabase/admin";
import { montarDados } from "@/lib/relatorio/dados";
import { gerarPdfRelatorio } from "@/lib/relatorio/pdf";

function voltar(obraId: string, erro?: string, ok?: string): never {
  revalidatePath(`/obras/${obraId}`, "layout");
  const q = erro ? `?erro=${encodeURIComponent(erro)}` : ok ? `?ok=${encodeURIComponent(ok)}` : "";
  redirect(`/obras/${obraId}/relatorio${q}`);
}

// Tira uma fotografia dos números de agora e grava o PDF. Nasce como rascunho: o cliente só vê depois de publicar.
export async function gerarRelatorio(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") redirect(`/obras/${obraId}`);

  const mes = String(fd.get("competencia") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) voltar(obraId, "Escolha o mês do relatório.");
  const competencia = `${mes}-01`;

  const { data: existente } = await supabase
    .from("relatorios_mensais")
    .select("publicado_em")
    .eq("obra_id", obraId)
    .eq("competencia", competencia)
    .maybeSingle();
  if (existente?.publicado_em) voltar(obraId, "O relatório deste mês já foi publicado. Retire do portal antes de gerar de novo.");

  const obra = await carregarObra(supabase, obraId);
  const dados = await montarDados(supabase, obra);
  const pdf = await gerarPdfRelatorio(dados, competencia);

  // O bucket só tem regra de leitura para usuários: a gravação usa a chave do servidor, depois de conferir o admin acima.
  const caminho = `${perfil.empresa_id}/${obraId}/${mes}.pdf`;
  const { error: erroEnvio } = await createAdminClient()
    .storage.from("relatorios")
    .upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (erroEnvio) voltar(obraId, `Não foi possível gravar o PDF (${erroEnvio.message}).`);

  const { error } = await supabase.from("relatorios_mensais").upsert(
    {
      obra_id: obraId,
      competencia,
      dados,
      pdf_path: caminho,
      gerado_por: perfil.id,
      gerado_em: dados.gerado_em,
      publicado_em: null,
    },
    { onConflict: "obra_id,competencia" },
  );
  if (error) voltar(obraId, traduzir(error.message));
  voltar(obraId, undefined, "Relatório gerado. Confira e publique para o cliente.");
}

export async function publicarRelatorio(obraId: string, relatorioId: string, publicar: boolean) {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") redirect(`/obras/${obraId}`);

  const { error } = await supabase
    .from("relatorios_mensais")
    .update({ publicado_em: publicar ? new Date().toISOString() : null })
    .eq("id", relatorioId)
    .eq("obra_id", obraId);
  if (error) voltar(obraId, traduzir(error.message));
  voltar(obraId, undefined, publicar ? "Publicado: o cliente já pode baixar no portal." : "Retirado do portal do cliente.");
}
