"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { processarArquivos, type ArquivoEnviado, type Resultado } from "./actions";

const MIME_POR_EXTENSAO: Record<string, string> = {
  xml: "text/xml",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Foto de celular costuma passar de 5 MB: reduz para 2000 px em JPEG antes de enviar. */
async function reduzirFoto(arquivo: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha()), "image/jpeg", 0.85));
  } catch {
    return arquivo;
  }
}

export function EnviarNotas({ empresaId, obraId }: { empresaId: string; obraId: string }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [etapa, setEtapa] = useState<"livre" | "enviando" | "lendo">("livre");
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function enviar() {
    const supabase = createClient();
    setResultados([]);
    setEtapa("enviando");
    const enviados: ArquivoEnviado[] = [];
    const falhas: Resultado[] = [];

    for (const arquivo of arquivos) {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME_POR_EXTENSAO[ext];
      if (!mime) {
        falhas.push({ nome: arquivo.name, ok: false, mensagem: "formato não aceito (use XML, PDF, JPG, PNG ou WEBP)." });
        continue;
      }
      const ehFoto = mime.startsWith("image/");
      const corpo = ehFoto ? await reduzirFoto(arquivo) : arquivo;
      const tipoFinal = ehFoto ? corpo.type || mime : mime;
      const path = `${empresaId}/${obraId}/${crypto.randomUUID()}.${ehFoto && tipoFinal === "image/jpeg" ? "jpg" : ext}`;
      const { error } = await supabase.storage.from("nfe-xml").upload(path, corpo, { contentType: tipoFinal });
      if (error) falhas.push({ nome: arquivo.name, ok: false, mensagem: `falha no envio (${error.message}).` });
      else enviados.push({ path, nome: arquivo.name, mime: tipoFinal });
    }

    setEtapa("lendo");
    const lidos = enviados.length ? await processarArquivos(obraId, enviados) : [];
    setResultados([...lidos, ...falhas]);
    setArquivos([]);
    setEtapa("livre");
  }

  const algumOk = resultados.some((r) => r.ok);

  return (
    <div className="flex flex-col gap-4">
      <label className="border-2 border-dashed border-stone-300 rounded-xl p-8 text-center cursor-pointer hover:bg-stone-50">
        <input
          type="file"
          multiple
          accept=".xml,.pdf,.jpg,.jpeg,.png,.webp,image/*"
          className="hidden"
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
        />
        <p className="font-medium">Escolher arquivos</p>
        <p className="text-sm text-stone-500">XML da NF-e, PDF da nota (DANFE) ou foto do cupom. Pode escolher vários.</p>
      </label>

      {arquivos.length > 0 && (
        <ul className="text-sm text-stone-700 list-disc pl-5">
          {arquivos.map((a) => (
            <li key={a.name}>{a.name}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={!arquivos.length || etapa !== "livre"}
        onClick={enviar}
        className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700 disabled:opacity-40"
      >
        {etapa === "enviando" ? "Enviando..." : etapa === "lendo" ? "Lendo as notas..." : "Importar"}
      </button>

      {resultados.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {resultados.map((r) => (
            <li key={r.nome} className={`rounded-md px-3 py-2 ${r.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
              <span className="font-medium">{r.nome}:</span> {r.mensagem}
            </li>
          ))}
        </ul>
      )}
      {algumOk && (
        <Link href={`/obras/${obraId}/conferir`} className="self-start underline font-medium">
          Conferir e confirmar as notas importadas
        </Link>
      )}
    </div>
  );
}
