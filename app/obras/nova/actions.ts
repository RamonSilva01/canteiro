"use server";

import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { numero, texto } from "@/lib/format";

// Usado quando a empresa ainda não cadastrou um template padrão próprio.
const ETAPAS_PADRAO = [
  "Locação",
  "Serviços preliminares",
  "Fundação e estrutura",
  "Alvenaria",
  "Cobertura",
  "Instalação elétrica",
  "Instalação hidráulica",
  "Esquadrias",
  "Acabamentos",
  "Pintura",
  "Mão de obra",
];

export async function criarObra(fd: FormData) {
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect("/");

  // Id gerado aqui e insert sem RETURNING: o colaborador só passa a enxergar a obra
  // depois que o banco o vincula a ela (trigger da migration 0005).
  const obra = { id: crypto.randomUUID() };
  const { error } = await supabase
    .from("obras")
    .insert({
      id: obra.id,
      empresa_id: perfil.empresa_id,
      criada_por: perfil.id,
      nome: texto(fd.get("nome")),
      cliente_nome: texto(fd.get("cliente_nome")),
      endereco_logradouro: texto(fd.get("endereco_logradouro")),
      endereco_cidade: texto(fd.get("endereco_cidade")),
      endereco_uf: texto(fd.get("endereco_uf"))?.toUpperCase() ?? null,
      data_inicio: texto(fd.get("data_inicio")),
      data_entrega_prevista: texto(fd.get("data_entrega_prevista")),
      projecao_venda: numero(fd.get("projecao_venda")),
    });
  if (error) redirect(`/obras/nova?erro=${encodeURIComponent(error.message)}`);

  const { data: tpl } = await supabase.from("templates_obra").select("id").eq("eh_padrao", true).maybeSingle();
  if (tpl) {
    await supabase.rpc("aplicar_template_na_obra", { p_obra_id: obra.id, p_template_id: tpl.id });
  } else {
    await supabase.from("etapas").insert(ETAPAS_PADRAO.map((nome, i) => ({ obra_id: obra.id, nome, ordem: i + 1 })));
  }

  redirect(`/obras/${obra.id}?editar=1`);
}
