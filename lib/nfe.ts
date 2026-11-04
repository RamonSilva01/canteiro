import "server-only";
import { XMLParser } from "fast-xml-parser";

// Formato que a RPC importar_nota_fiscal espera (números como texto: o banco converte para numeric).
export type Valor = string | number | null;
export type NotaLida = { nota: Record<string, Valor>; itens: Record<string, Valor>[] };

const texto = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** Respeita o encoding declarado: muito XML de NF-e vem em ISO-8859-1. */
export function decodificarXml(buf: ArrayBuffer): string {
  const inicio = new TextDecoder("latin1").decode(buf.slice(0, 200));
  const encoding = /encoding=["']([\w-]+)["']/i.exec(inicio)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(encoding).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  }
}

/** XML da NF-e (modelo 55) ou NFC-e (65), com ou sem o protocolo (nfeProc). */
export function lerNfe(xml: string): NotaLida {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false, // CNPJ e códigos ficam como texto (zeros à esquerda)
    isArray: (nome) => nome === "det", // nota de um item só vem como objeto
  });

  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error("arquivo XML corrompido ou ilegível.");
  }
  const inf = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe;
  if (!inf) {
    throw new Error(
      "não é uma NF-e. Nota de serviço (NFS-e) tem layout próprio de cada prefeitura: envie o PDF ou lance manualmente.",
    );
  }

  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const dest = inf.dest ?? {};
  const tot = inf.total?.ICMSTot ?? {};
  const modelo = texto(ide.mod);
  if (modelo && !["55", "65"].includes(modelo)) throw new Error(`modelo ${modelo} não suportado (só NF-e 55 e NFC-e 65).`);

  const det: Record<string, unknown>[] = inf.det ?? [];
  if (det.length === 0) throw new Error("a nota não tem itens.");

  return {
    nota: {
      origem: "xml_nfe",
      arquivo_tipo: "xml",
      chave_acesso: texto(inf["@Id"])?.replace(/^NFe/, "") ?? null,
      numero: texto(ide.nNF),
      serie: texto(ide.serie),
      modelo,
      natureza_operacao: texto(ide.natOp),
      data_emissao: texto(ide.dhEmi) ?? texto(ide.dEmi),
      emit_cnpj: texto(emit.CNPJ),
      emit_nome: texto(emit.xNome),
      emit_fantasia: texto(emit.xFant),
      emit_uf: texto(emit.enderEmit?.UF),
      dest_documento: texto(dest.CNPJ) ?? texto(dest.CPF),
      dest_nome: texto(dest.xNome),
      valor_produtos: texto(tot.vProd),
      valor_desconto: texto(tot.vDesc),
      valor_frete: texto(tot.vFrete),
      valor_seguro: texto(tot.vSeg),
      valor_ipi: texto(tot.vIPI),
      valor_icms_st: texto(tot.vST),
      valor_outras: texto(tot.vOutro),
      valor_total: texto(tot.vNF),
    },
    itens: det.map((d) => {
      const p = (d.prod ?? {}) as Record<string, unknown>;
      return {
        item_numero: Number(d["@nItem"]),
        descricao: texto(p.xProd),
        codigo_produto: texto(p.cProd),
        ncm: texto(p.NCM),
        cfop: texto(p.CFOP),
        ean: texto(p.cEAN),
        unidade: texto(p.uCom),
        quantidade: texto(p.qCom),
        valor_unitario: texto(p.vUnCom),
        valor_total: texto(p.vProd),
      };
    }),
  };
}
