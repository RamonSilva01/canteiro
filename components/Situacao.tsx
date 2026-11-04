import { reais } from "@/lib/format";

const ROTULOS: Record<string, [string, string]> = {
  adiantada: ["Adiantada", "bg-emerald-100 text-emerald-800"],
  no_prazo: ["No prazo", "bg-amber-100 text-amber-800"],
  atrasada: ["Atrasada", "bg-red-100 text-red-800"],
  sem_prazo: ["Sem prazo", "bg-stone-200 text-stone-600"],
};

export function Situacao({ valor }: { valor: string | null }) {
  const [rotulo, cor] = ROTULOS[valor ?? "sem_prazo"] ?? ROTULOS.sem_prazo;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cor}`}>{rotulo}</span>;
}

/** Preenchimento = avanço real; risco vertical = esperado para hoje. */
export function BarraDupla({ real, esperado }: { real: number; esperado: number | null }) {
  return (
    <div className="relative h-2 rounded-full bg-stone-200">
      <div className="absolute inset-y-0 left-0 rounded-full bg-stone-800" style={{ width: `${Math.min(real, 100)}%` }} />
      {esperado != null && (
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-amber-500" style={{ left: `${Math.min(esperado, 100)}%` }} />
      )}
    </div>
  );
}

export function Economia({ valor }: { valor: number }) {
  const cor = valor < 0 ? "text-red-600" : valor > 0 ? "text-emerald-700" : "text-stone-500";
  const sinal = valor > 0 ? "+" : "";
  return (
    <span className={`num ${cor}`}>
      {sinal}
      {reais(valor)}
    </span>
  );
}
