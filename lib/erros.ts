// Traduz os erros do banco que o usuário pode provocar para uma frase em português.
const CONHECIDOS: [string, string][] = [
  ["etapas_nome_uk", "Já existe uma etapa com esse nome nesta obra."],
  ["etapas_datas_ck", "O fim previsto da etapa não pode ser antes do início."],
  ["as fases não podem se sobrepor", "As fases de uma etapa não podem se sobrepor: cada uma começa depois que a anterior termina."],
  ["cada fase precisa de início e fim", "Cada fase precisa de início e fim, com o fim depois do início."],
  ["obras_datas_ck", "A entrega prevista não pode ser antes do início da obra."],
  ["obras_uf_ck", "UF deve ter 2 letras (ex.: MG)."],
  ["lancamentos_etapa_fk", "Esta etapa tem lançamentos. Mova ou exclua os lançamentos antes de remover a etapa."],
  ["lancamentos_subetapa_fk", "A subetapa escolhida não pertence a essa etapa."],
  ["lancamentos_valor_ck", "Valor inválido: desconto é negativo, os demais componentes são positivos."],
  ["subetapas_nome_uk", "Já existe uma subetapa com esse nome nesta etapa."],
  ["row-level security", "Você não tem permissão para essa alteração."],
  ["not-null", "Preencha os campos obrigatórios."],
];

export function traduzir(mensagem: string) {
  const achado = CONHECIDOS.find(([chave]) => mensagem.includes(chave));
  return achado ? achado[1] : `Não foi possível salvar (${mensagem}).`;
}
