export function Kpi({
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  tom?: "ok" | "bad";
}) {
  return (
    <div className="kpi">
      <div className="label">{rotulo}</div>
      <div className={`value num ${tom ?? ""}`}>{valor}</div>
      {detalhe && <div className="delta">{detalhe}</div>}
    </div>
  );
}
