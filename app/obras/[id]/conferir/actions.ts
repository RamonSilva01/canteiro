"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { traduzir } from "@/lib/erros";

const caminho = (obraId: string) => `/obras/${obraId}/conferir`;

// Cada linha manda "etapaId|subetapaId" no select e um checkbox de confirmar.
// Confirmar grava a classificação escolhida, que vira histórico para as próximas sugestões.
export async function confirmarLancamentos(obraId: string, fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(`/obras/${obraId}`);

  const marcados = fd.getAll("ok").map(String);
  let semEtapa = 0;
  const atualizacoes = marcados.flatMap((id) => {
    const [etapaId, subetapaId] = String(fd.get(`c_${id}`) ?? "").split("|");
    if (!etapaId) {
      semEtapa++;
      return [];
    }
    return [
      supabase
        .from("lancamentos")
        .update({ etapa_id: etapaId, subetapa_id: subetapaId || null, status: "confirmado" })
        .eq("id", id)
        .eq("obra_id", obraId)
        .eq("status", "pendente"),
    ];
  });
  const resultados = await Promise.all(atualizacoes);
  const erro = resultados.find((r) => r.error)?.error;

  revalidatePath(`/obras/${obraId}`, "layout");
  const params = new URLSearchParams();
  if (erro) params.set("erro", traduzir(erro.message));
  else if (semEtapa) params.set("erro", `${semEtapa} linha(s) marcada(s) sem etapa ficaram pendentes.`);
  params.set("confirmados", String(resultados.filter((r) => !r.error).length));
  redirect(`${caminho(obraId)}?${params}`);
}

export async function descartarLancamento(obraId: string, lancamentoId: string) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(`/obras/${obraId}`);

  await supabase
    .from("lancamentos")
    .update({ excluido_em: new Date().toISOString(), excluido_por: perfil.id })
    .eq("id", lancamentoId)
    .eq("obra_id", obraId);
  revalidatePath(`/obras/${obraId}`, "layout");
  redirect(caminho(obraId));
}
