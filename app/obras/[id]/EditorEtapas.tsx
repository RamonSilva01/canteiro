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
  fases: { inicio: string; fim: string }[] | null;
  obra_toda: boolean;
};

type Periodo = { k: number; inicio: string; fim: string };

// Período previsto da etapa: uma janela, várias fases (hidráulica no início, meio e fim)
// ou a obra toda (mão de obra, locação). O servidor guarda 2+ períodos como fases.
function Periodos({ etapa }: { etapa: EtapaEditavel }) {
  const id = etapa.etapa_id;
  const iniciais = etapa.fases?.length
    ? etapa.fases
    : [{ inicio: etapa.data_inicio_prevista ?? "", fim: etapa.data_fim_prevista ?? "" }];
  const [periodos, setPeriodos] = useState<Periodo[]>(iniciais.map((p, k) => ({ k, inicio: p.inicio ?? "", fim: p.fim ?? "" })));
  const [toda, setToda] = useState(etapa.obra_toda);
  const [proximo, setProximo] = useState(iniciais.length);

  const mudar = (k: number, campo: "inicio" | "fim", valor: string) =>
    setPeriodos((ps) => ps.map((p) => (p.k === k ? { ...p, [campo]: valor } : p)));

  return (
    <div className="col-span-2 md:col-span-1 flex flex-col gap-1">
      <div className={toda ? "hidden" : "flex flex-col gap-1"}>
        {periodos.map((p, i) => (
          <div key={p.k} className="flex items-center gap-1">
            <input
              name={`ini_${id}`}
              type="date"
              value={p.inicio}
              onChange={(ev) => mudar(p.k, "inicio", ev.target.value)}
              className={inputPequeno}
              aria-label={periodos.length > 1 ? `Início da ${i + 1}ª fase` : "Início previsto"}
            />
            <input
              name={`fim_${id}`}
              type="date"
              value={p.fim}
              onChange={(ev) => mudar(p.k, "fim", ev.target.value)}
              className={inputPequeno}
              aria-label={periodos.length > 1 ? `Fim da ${i + 1}ª fase` : "Fim previsto"}
            />
            {periodos.length > 1 && (
              <button
                type="button"
                onClick={() => setPeriodos((ps) => ps.filter((x) => x.k !== p.k))}
                aria-label={`Tirar a ${i + 1}ª fase`}
                title="Tirar esta fase"
                className="px-1 text-stone-400 hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {toda && <p className="text-xs text-stone-500 py-1">Acompanha o início e a entrega prevista da obra.</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {!toda && (
          <button
            type="button"
            onClick={() => {
              setPeriodos((ps) => [...ps, { k: proximo, inicio: "", fim: "" }]);
              setProximo((n) => n + 1);
            }}
            className="text-stone-600 underline"
          >
            + fase
          </button>
        )}
        <label className="flex items-center gap-1 text-stone-600">
          <input type="checkbox" name={`toda_${id}`} checked={toda} onChange={(ev) => setToda(ev.target.checked)} />
          obra toda
        </label>
      </div>
    </div>
  );
}

function Linha({ obraId, etapa, posicao }: { obraId: string; etapa: EtapaEditavel; posicao: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: etapa.etapa_id });
  const id = etapa.etapa_id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`grid grid-cols-2 md:grid-cols-[3.5rem_1fr_9rem_minmax(0,20rem)_5rem] gap-2 border-b border-stone-100 pb-2 bg-white ${
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
      <Periodos etapa={etapa} />
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
      <div className="hidden md:grid grid-cols-[3.5rem_1fr_9rem_minmax(0,20rem)_5rem] gap-2 text-xs text-stone-500">
        <span>Ordem</span>
        <span>Nome</span>
        <span>Orçamento (R$)</span>
        <span>Período previsto (início e fim)</span>
        <span />
      </div>
      <DndContext id={idDnd} sensors={sensores} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={soltar}>
        <SortableContext items={lista.map((e) => e.etapa_id)} strategy={verticalListSortingStrategy}>
          {lista.map((e, i) => (
            <Linha key={`${e.etapa_id}|${e.obra_toda}|${e.data_inicio_prevista}|${e.data_fim_prevista}|${JSON.stringify(e.fases)}`} obraId={obraId} etapa={e} posicao={i + 1} />
          ))}
        </SortableContext>
      </DndContext>
      <button type="submit" className="self-end bg-stone-900 text-white rounded-md px-4 py-2 hover:bg-stone-700">
        Salvar etapas
      </button>
    </form>
  );
}
