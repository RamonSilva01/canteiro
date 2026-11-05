import "server-only";
import Anthropic from "@anthropic-ai/sdk";
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
        required: ["descricao", "unidade", "quantidade", "valor_unitario", "valor_total"],
        additionalProperties: false,
      },
    },
    valor_frete: { type: ["number", "null"] },
    valor_desconto: { type: ["number", "null"], description: "desconto total, número positivo" },
    valor_outras: { type: ["number", "null"], description: "outras despesas, seguro, IPI somados" },
    valor_total: { type: ["number", "null"], description: "valor total pago na nota" },
  },
  required: [
    "eh_nota",
    "emit_nome",
    "emit_cnpj",
    "numero",
    "data_emissao",
    "chave_acesso",
    "itens",
    "valor_frete",
    "valor_desconto",
    "valor_outras",
    "valor_total",
  ],
  additionalProperties: false,
};

const INSTRUCAO =
  "Extraia os dados desta nota fiscal de compra de material ou serviço de obra. " +
  "Copie as descrições dos itens como estão escritas. Não invente valores: use null quando não estiver legível.";

const MIMES_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type MimeImagem = (typeof MIMES_IMAGEM)[number];

const digitos = (v: unknown, n: number) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === n ? d : null;
};
const dinheiro = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : null);

export async function lerNotaComIa(arquivo: ArrayBuffer, mime: string): Promise<NotaLida> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error("leitura de PDF/foto ainda não está ligada (falta ANTHROPIC_API_KEY).");

  const data = Buffer.from(arquivo).toString("base64");
  const bloco: Anthropic.Beta.BetaContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime as MimeImagem, data } };

  let resposta: Anthropic.Beta.BetaMessage;
  try {
    resposta = await new Anthropic({ apiKey: chave }).beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: [bloco, { type: "text", text: INSTRUCAO }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      throw new Error(`a leitura automática falhou (${e.status ?? "sem conexão"}). Tente de novo ou lance manualmente.`);
    }
    throw e;
  }
  if (resposta.stop_reason === "refusal" || resposta.stop_reason === "max_tokens") {
    throw new Error("a leitura automática não conseguiu concluir esta nota. Lance manualmente.");
  }

  const texto = resposta.content.find((c) => c.type === "text");
  const lido = texto?.type === "text" ? JSON.parse(texto.text) : null;
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
