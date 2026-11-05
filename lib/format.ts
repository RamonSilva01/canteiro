const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const reais = (v: number | string | null | undefined) => brl.format(Number(v ?? 0));

export const pct = (v: number | string | null | undefined) =>
  v == null
    ? "-"
    : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "-");

/** "1.234,56", "1234,56", "100.000" ou "1234.56" -> número; vazio -> null */
export function numero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(/\s|R\$/g, "");
  if (!s) return null;
  const soMilhar = /^-?\d{1,3}(\.\d{3})+$/.test(s); // "100.000" é cem mil, não cem
  const normal = s.includes(",") || soMilhar ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export const texto = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

/** Data de hoje no fuso da obra (mesma regra do app.hoje() do banco). */
export const hojeSP = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const brlInteiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const reaisInteiro = (v: number | string | null | undefined) => brlInteiro.format(Number(v ?? 0));
