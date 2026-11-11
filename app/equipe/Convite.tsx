"use client";

import { useActionState, useState, useTransition } from "react";
import { convidar, novoLink, type EstadoConvite } from "./actions";

function LinkPronto({ estado }: { estado: EstadoConvite }) {
  const [copiado, setCopiado] = useState(false);
  if (estado.erro) return <p className="text-sm text-red-600">{estado.erro}</p>;
  if (!estado.link) return null;
  const mensagem = `Olá, ${estado.nome}! Este é o seu acesso ao acompanhamento da obra no Canteiro: ${estado.link}`;
  return (
    <div className="bg-emerald-50 rounded-md p-3 text-sm flex flex-col gap-2">
      <p className="text-emerald-900">
        Link de acesso de {estado.nome} pronto. Vale por 24 horas e só pode ser usado uma vez: a pessoa cria a senha dela ao abrir.
      </p>
      <input readOnly value={estado.link} className="border border-emerald-200 rounded px-2 py-1 bg-white text-xs" />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(estado.link!).then(() => setCopiado(true))}
          className="underline"
        >
          {copiado ? "Copiado" : "Copiar link"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noreferrer" className="underline">
          Enviar por WhatsApp
        </a>
      </div>
    </div>
  );
}

export function FormConvite({ obras }: { obras: { id: string; nome: string }[] }) {
  const [estado, acao, enviando] = useActionState(convidar, {});
  const [papel, setPapel] = useState("cliente");

  return (
    <form action={acao} className="flex flex-col gap-3">
      <div className="grid md:grid-cols-3 gap-3">
        <input name="nome" required placeholder="Nome" className="border border-stone-300 rounded-md px-3 py-2 bg-white" />
        <input name="email" type="email" required placeholder="E-mail" className="border border-stone-300 rounded-md px-3 py-2 bg-white" />
        <select
          name="papel"
          value={papel}
          onChange={(e) => setPapel(e.target.value)}
          className="border border-stone-300 rounded-md px-3 py-2 bg-white"
        >
          <option value="cliente">Cliente (vê a obra, não edita)</option>
          <option value="colaborador">Colaborador (cria obras, lança e atualiza avanço)</option>
          <option value="admin">Administrador (tudo)</option>
        </select>
      </div>
      {papel !== "admin" && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <legend className="text-stone-500 mb-1">Obras que essa pessoa acompanha</legend>
          {obras.map((o) => (
            <label key={o.id} className="flex items-center gap-1">
              <input type="checkbox" name="obra" value={o.id} /> {o.nome}
            </label>
          ))}
        </fieldset>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="self-start bg-stone-900 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-stone-700 disabled:opacity-40"
      >
        {enviando ? "Gerando..." : "Gerar link de acesso"}
      </button>
      <LinkPronto estado={estado} />
    </form>
  );
}

export function BotaoNovoLink({ usuarioId }: { usuarioId: string }) {
  const [estado, setEstado] = useState<EstadoConvite>({});
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pendente}
        onClick={() => iniciar(async () => setEstado(await novoLink(usuarioId)))}
        className="self-start text-xs underline text-stone-600"
      >
        {pendente ? "Gerando..." : "Gerar novo link de acesso (esqueceu a senha)"}
      </button>
      <LinkPronto estado={estado} />
    </div>
  );
}
