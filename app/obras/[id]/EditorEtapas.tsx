"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { inputPequeno } from "@/components/Campo";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { removerEtapa, reordenarEtapas, salvarEtapas } from "./actions";

export type EtapaEditavel = {
  etapa_id: string;
  nome: string;
  orcamento_referencia: number;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
};

function Linha({ obraId, etapa, posicao }: { obraId: string; etapa: EtapaEditavel; posicao: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: etapa.etapa_id });
  const id = etapa.etapa_id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`grid grid-cols-2 md:grid-cols-[3.5rem_1fr_9rem_9rem_9rem_5rem] gap-2 border-b border-stone-100 pb-2 bg-white ${
        isDragging ? "relative z-10 shadow-md rounded-md" : ""
      }`}
    >
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-1 text-sm text-stone-500">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Mover a etapa ${etapa.nome}`}
          title="Arraste para mudar a posição"
          className="cursor-grab active:cursor-grabbing touch-none px-1 text-lg leading-none text-stone-400 hover:text-stone-700"
        >
          ⠿
        </button>
        <span className="num">{posicao}</span>
      </div>
      <input name={`nome_${id}`} defaultValue={etapa.nome} required className={inputPequeno} aria-label="Nome" />
      <input
        name={`orc_${id}`}
        defaultValue={Number(etapa.orcamento_referencia).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        inputMode="decimal"
        className={`${inputPequeno} text-right num`}
        aria-label="Orçamento"
      />
      <input name={`ini_${id}`} type="date" defaultValue={etapa.data_inicio_prevista ?? ""} className={inputPequeno} aria-label="Início previsto" />
      <input name={`fim_${id}`} type="date" defaultValue={etapa.data_fim_prevista ?? ""} className={inputPequeno} aria-label="Fim previsto" />
      <BotaoConfirmar
        pergunta={`Remover a etapa "${etapa.nome}"? Etapa com lançamentos não pode ser removida.`}
        formAction={removerEtapa.bind(null, obraId, id)}
        formNoValidate
        className="text-xs text-red-600 underline justify-self-start md:justify-self-end"
      >
        Remover
      </BotaoConfirmar>
    </div>
  );
}

export function EditorEtapas({ obraId, etapas }: { obraId: string; etapas: EtapaEditavel[] }) {
  const idDnd = useId();
  const [lista, setLista] = useState(etapas);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const sensores = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Etapa adicionada, removida ou salva: a lista vinda do servidor manda.
  useEffect(() => setLista(etapas), [etapas]);

  function soltar({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const anterior = lista;
    const de = lista.findIndex((e) => e.etapa_id === active.id);
    const para = lista.findIndex((e) => e.etapa_id === over.id);
    const nova = arrayMove(lista, de, para);
    setLista(nova);
    setErro(null);
    iniciar(async () => {
      const resultado = await reordenarEtapas(obraId, nova.map((e) => e.etapa_id));
      if (resultado?.erro) {
        setLista(anterior);
        setErro(resultado.erro);
      }
    });
  }

  return (
    <form action={salvarEtapas.bind(null, obraId)} className="mt-4 flex flex-col gap-2">
      {/* Primeiro botão do formulário: é ele que o Enter aciona, e não o Remover da primeira linha. */}
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
      <p className="text-sm text-stone-500" aria-live="polite">
        {salvando ? "Salvando a nova ordem..." : "Arraste pela alça ⠿ para mudar a posição. A ordem é salva ao soltar."}
      </p>
      {erro && <p className="bg-red-50 text-red-700 text-sm rounded-md px-4 py-2">{erro}</p>}
      <div className="hidden md:grid grid-cols-[3.5rem_1fr_9rem_9rem_9rem_5rem] gap-2 text-xs text-stone-500">
        <span>Ordem</span>
        <span>Nome</span>
        <span>Orçamento (R$)</span>
        <span>Início previsto</span>
        <span>Fim previsto</span>
        <span />
      </div>
      <DndContext id={idDnd} sensors={sensores} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={soltar}>
        <SortableContext items={lista.map((e) => e.etapa_id)} strategy={verticalListSortingStrategy}>
          {lista.map((e, i) => (
            <Linha key={e.etapa_id} obraId={obraId} etapa={e} posicao={i + 1} />
          ))}
        </SortableContext>
      </DndContext>
      <button type="submit" className="self-end bg-stone-900 text-white rounded-md px-4 py-2 hover:bg-stone-700">
        Salvar etapas
      </button>
    </form>
  );
}
