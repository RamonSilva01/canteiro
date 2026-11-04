"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { registrarFotos, type FotoEnviada } from "./actions";

/** Reduz para no máximo 2000 px em JPEG: foto de celular chega a 10 MB, aqui sai com ~500 KB. */
async function reduzir(arquivo: File) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha()), "image/jpeg", 0.82));
  return { blob, largura: canvas.width, altura: canvas.height };
}

export function EnviarFotos({
  empresaId,
  obraId,
  etapas,
}: {
  empresaId: string;
  obraId: string;
  etapas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [etapaId, setEtapaId] = useState("");
  const [legenda, setLegenda] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    setStatus(null);
    const supabase = createClient();
    const fotos: FotoEnviada[] = [];
    const falhas: string[] = [];

    for (const [i, arquivo] of arquivos.entries()) {
      setStatus(`Enviando ${i + 1} de ${arquivos.length}...`);
      try {
        const { blob, largura, altura } = await reduzir(arquivo);
        const path = `${empresaId}/${obraId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("obra-fotos").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        fotos.push({ path, mime: "image/jpeg", tamanho: blob.size, largura, altura });
      } catch {
        falhas.push(arquivo.name);
      }
    }

    const erro = fotos.length ? await registrarFotos(obraId, { etapaId: etapaId || null, legenda: legenda || null, fotos }) : null;
    setEnviando(false);
    setArquivos([]);
    setLegenda("");
    setStatus(
      erro ??
        [fotos.length && `${fotos.length} foto(s) publicada(s).`, falhas.length && `Não foi possível ler: ${falhas.join(", ")}.`]
          .filter(Boolean)
          .join(" "),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
        className="text-sm"
      />
      <div className="grid md:grid-cols-2 gap-3">
        <select
          value={etapaId}
          onChange={(e) => setEtapaId(e.target.value)}
          className="border border-stone-300 rounded-md px-3 py-2 bg-white text-sm"
        >
          <option value="">Etapa (opcional)</option>
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
        <input
          value={legenda}
          onChange={(e) => setLegenda(e.target.value)}
          placeholder="Legenda (opcional)"
          className="border border-stone-300 rounded-md px-3 py-2 bg-white text-sm"
        />
      </div>
      <button
        type="button"
        disabled={!arquivos.length || enviando}
        onClick={enviar}
        className="self-start bg-stone-900 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-stone-700 disabled:opacity-40"
      >
        Publicar {arquivos.length > 0 && `${arquivos.length} foto(s)`}
      </button>
      {status && <p className="text-sm text-stone-600">{status}</p>}
    </div>
  );
}
