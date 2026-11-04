export function Kpi({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <p className="text-xs text-stone-500">{rotulo}</p>
      <p className="text-lg font-semibold num">{valor}</p>
    </div>
  );
}
