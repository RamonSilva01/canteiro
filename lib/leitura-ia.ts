import "server-only";
import type { NotaLida } from "./nfe";

// Leitura de nota em PDF ou foto pela Claude API. Só extrai os dados:
// tudo entra pendente e o admin confere antes de valer (decisão de 02/09).

const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const ESQUEMA = {
  type: "object",
  properties: {
    eh_nota: { type: "boolean", description: "false se a imagem/PDF não for nota fiscal, cupom ou recibo de compra" },
    emit_nome: { type: ["string", "null"], description: "razão social ou nome do fornecedor" },
    emit_cnpj: { type: ["string", "null"], description: "CNPJ do fornecedor, só os 14 dígitos" },
    numero: { type: ["string", "null"], description: "número da nota/cupom/recibo" },
    data_emissao: { type: ["string", "null"], description: "data de emissão no formato AAAA-MM-DD" },
    chave_acesso: { type: ["string", "null"], description: "chave de acesso de 44 dígitos, se aparecer" },
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          unidade: { type: ["string", "null"] },
          quantidade: { type: ["number", "null"] },
          valor_unitario: { type: ["number", "null"] },
          valor_total: { type: "number", description: "valor bruto do item, antes de desconto" },
        },
        required: ["descricao", "valor_total"],
      },
    },
    valor_frete: { type: ["number", "null"] },
    valor_desconto: { type: ["number", "null"], description: "desconto total, número positivo" },
    valor_outras: { type: ["number", "null"], description: "outras despesas, seguro, IPI somados" },
    valor_total: { type: ["number", "null"], description: "valor total pago na nota" },
  },
  required: ["eh_nota", "itens"],
};

const INSTRUCAO =
  "Extraia os dados desta nota fiscal de compra de material ou serviço de obra. " +
  "Copie as descrições dos itens como estão escritas. Não invente valores: use null quando não estiver legível. " +
  "Chame a ferramenta registrar_nota com o resultado.";

const digitos = (v: unknown, n: number) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === n ? d : null;
};
const dinheiro = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : null);

export async function lerNotaComIa(arquivo: ArrayBuffer, mime: string): Promise<NotaLida> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error("leitura de PDF/foto ainda não está ligada (falta ANTHROPIC_API_KEY).");

  const data = Buffer.from(arquivo).toString("base64");
  const bloco =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data } }
      : { type: "image", source: { type: "base64", media_type: mime, data } };

  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8000,
      tools: [{ name: "registrar_nota", description: "Registra os dados lidos da nota", input_schema: ESQUEMA }],
      tool_choice: { type: "tool", name: "registrar_nota" },
      messages: [{ role: "user", content: [bloco, { type: "text", text: INSTRUCAO }] }],
    }),
  });
  if (!resposta.ok) throw new Error(`a leitura automática falhou (${resposta.status}). Tente de novo ou lance manualmente.`);

  const corpo = await resposta.json();
  const lido = corpo.content?.find((c: { type: string }) => c.type === "tool_use")?.input;
  if (!lido?.eh_nota) throw new Error("o arquivo não parece ser uma nota fiscal ou recibo.");
  if (!Array.isArray(lido.itens) || lido.itens.length === 0) throw new Error("não foi possível ler os itens da nota.");

  return {
    nota: {
      origem: "documento_ia",
      arquivo_tipo: mime === "application/pdf" ? "pdf" : "imagem",
      chave_acesso: digitos(lido.chave_acesso, 44),
      numero: lido.numero ?? null,
      data_emissao: /^\d{4}-\d{2}-\d{2}$/.test(lido.data_emissao ?? "") ? `${lido.data_emissao}T12:00:00-03:00` : null,
      emit_cnpj: digitos(lido.emit_cnpj, 14),
      emit_nome: lido.emit_nome ?? null,
      valor_frete: dinheiro(lido.valor_frete),
      valor_desconto: dinheiro(lido.valor_desconto != null ? Math.abs(lido.valor_desconto) : null),
      valor_outras: dinheiro(lido.valor_outras),
      valor_total: dinheiro(lido.valor_total),
    },
    itens: lido.itens.map((i: Record<string, unknown>, n: number) => ({
      item_numero: n + 1,
      descricao: String(i.descricao ?? "Item sem descrição"),
      unidade: (i.unidade as string) ?? null,
      quantidade: typeof i.quantidade === "number" ? String(i.quantidade) : null,
      valor_unitario: typeof i.valor_unitario === "number" ? String(i.valor_unitario) : null,
      valor_total: dinheiro(i.valor_total) ?? "0.00",
    })),
  };
}
