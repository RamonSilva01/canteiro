"use server";

import { revalidatePath } from "next/cache";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { decodificarXml, lerNfe, type NotaLida } from "@/lib/nfe";
import { lerNotaComIa } from "@/lib/leitura-ia";
import { dataBR, reais } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export type ArquivoEnviado = { path: string; nome: string; mime: string };
export type Resultado = { nome: string; ok: boolean; mensagem: string };

// O navegador já subiu cada arquivo para o bucket nfe-xml; aqui o servidor lê,
// interpreta e grava a nota (tudo pendente, para conferência).
export async function processarArquivos(obraId: string, arquivos: ArquivoEnviado[]): Promise<Resultado[]> {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) return arquivos.map((a) => ({ nome: a.nome, ok: false, mensagem: "sem permissão" }));

  const resultados: Resultado[] = [];
  for (const arquivo of arquivos) {
    try {
      const { data: blob, error } = await supabase.storage.from("nfe-xml").download(arquivo.path);
      if (error || !blob) throw new Error("não foi possível ler o arquivo enviado.");
      const conteudo = await blob.arrayBuffer();

      const lida: NotaLida =
        arquivo.mime.includes("xml") ? lerNfe(decodificarXml(conteudo)) : await lerNotaComIa(conteudo, arquivo.mime);
      lida.nota.arquivo_path = arquivo.path;

      const { error: erroRpc } = await supabase.rpc("importar_nota_fiscal", {
        p_obra_id: obraId,
        p_nota: lida.nota,
        p_itens: lida.itens,
      });
      if (erroRpc) {
        const duplicada = /NOTA_DUPLICADA:([0-9a-f-]{36})/.exec(erroRpc.message);
        if (duplicada) {
          const { data: anterior } = await supabase
            .from("notas_fiscais")
            .select("numero, emit_nome, valor_total, importada_em")
            .eq("id", duplicada[1])
            .maybeSingle();
          throw new Error(
            `vetada por parecer repetida: já existe a NF ${anterior?.numero ?? "s/n"} de ${anterior?.emit_nome ?? "fornecedor não identificado"}, ${reais(anterior?.valor_total)}, importada em ${dataBR(anterior?.importada_em)}. Se for outra nota, lance manualmente.`,
          );
        }
        throw new Error(erroRpc.message);
      }

      const fornecedor = lida.nota.emit_nome ?? "fornecedor não identificado";
      resultados.push({
        nome: arquivo.nome,
        ok: true,
        mensagem: `NF ${lida.nota.numero ?? "s/n"} de ${fornecedor}, ${lida.itens.length} item(ns)`,
      });
    } catch (e) {
      // Arquivo que não virou nota (repetida, ilegível) não fica ocupando o bucket.
      // A equipe não tem permissão de apagar ali; o caminho é conferido antes.
      if (arquivo.path.startsWith(`${perfil.empresa_id}/${obraId}/`) && !arquivo.path.includes("..")) {
        await createAdminClient().storage.from("nfe-xml").remove([arquivo.path]);
      }
      resultados.push({ nome: arquivo.nome, ok: false, mensagem: e instanceof Error ? e.message : String(e) });
    }
  }

  revalidatePath(`/obras/${obraId}`, "layout");
  return resultados;
}
