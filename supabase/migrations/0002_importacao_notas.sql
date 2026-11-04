-- ============================================================
-- Canteiro · 0002 · importação de notas e sugestão de classificação
-- docs/03-arquitetura.md §4. Rodar no SQL Editor depois da 0001.
--   · origem 'documento_ia': nota lida de PDF ou foto pela Claude API
--   · sugerir_classificacao: histórico exato > texto parecido > regras
--   · importar_nota_fiscal: cabeçalho + itens + componentes (D2) numa
--     transação só; tudo nasce pendente e o admin confirma na conferência
-- ============================================================

alter type public.origem_lancamento add value if not exists 'documento_ia';

-- ------------------------------------------------------------
-- Sugestão de etapa/subetapa para um item (sem IA).
-- O histórico é da empresa inteira; a etapa é casada por NOME dentro da
-- obra alvo, porque cada obra tem as suas próprias linhas de etapa.
-- ------------------------------------------------------------
create or replace function public.sugerir_classificacao(
  p_obra_id    uuid,
  p_cnpj       text,
  p_codigo     text,
  p_ncm        text,
  p_descricao  text
)
returns table (etapa_id uuid, subetapa_id uuid, origem public.origem_sugestao,
               confianca numeric, justificativa text)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_etapa  text;
  v_sub    text;
  v_freq   bigint;
  v_score  numeric;
  v_ref    text;
  v_desc   text := unaccent(lower(coalesce(p_descricao, '')));
begin
  -- Camada 1: mesmo fornecedor e mesmo produto (código ou NCM)
  if p_cnpj is not null then
    select e.nome, s.nome, count(*)
      into v_etapa, v_sub, v_freq
      from public.lancamentos l
      join public.etapas e on e.id = l.etapa_id
      left join public.subetapas s on s.id = l.subetapa_id
     where l.empresa_id = app.empresa_id()
       and l.status = 'confirmado' and l.excluido_em is null
       and l.componente = 'item'
       and l.fornecedor_cnpj = p_cnpj
       and ((p_codigo is not null and l.codigo_produto = p_codigo)
            or (p_ncm is not null and l.ncm = p_ncm))
     group by e.nome, s.nome
     order by count(*) desc, max(l.confirmado_em) desc
     limit 1;

    if v_etapa is not null then
      return query
        select e.id, s.id, 'historico'::public.origem_sugestao, 0.95::numeric,
               format('%s compra(s) igual(is) deste fornecedor foram para %s', v_freq, v_etapa)
          from public.etapas e
          left join public.subetapas s on s.etapa_id = e.id and lower(s.nome) = lower(v_sub)
         where e.obra_id = p_obra_id and lower(e.nome) = lower(v_etapa)
         limit 1;
      if found then return; end if;
    end if;
  end if;

  -- Camada 2: descrição parecida com algo já classificado
  if length(v_desc) >= 3 then
    select e.nome, s.nome, similarity(unaccent(lower(l.descricao)), v_desc), l.descricao
      into v_etapa, v_sub, v_score, v_ref
      from public.lancamentos l
      join public.etapas e on e.id = l.etapa_id
      left join public.subetapas s on s.id = l.subetapa_id
     where l.empresa_id = app.empresa_id()
       and l.status = 'confirmado' and l.excluido_em is null
       and l.componente = 'item'
       and similarity(unaccent(lower(l.descricao)), v_desc) >= 0.45
     order by 3 desc, l.confirmado_em desc
     limit 1;

    if v_etapa is not null then
      return query
        select e.id, s.id, 'historico'::public.origem_sugestao, round(v_score, 3),
               format('Parecido com "%s" (%s)', v_ref, v_etapa)
          from public.etapas e
          left join public.subetapas s on s.etapa_id = e.id and lower(s.nome) = lower(v_sub)
         where e.obra_id = p_obra_id and lower(e.nome) = lower(v_etapa)
         limit 1;
      if found then return; end if;
    end if;
  end if;

  -- Camada 3: dicionário de regras da empresa
  select r.etapa_nome, r.subetapa_nome, r.termo
    into v_etapa, v_sub, v_ref
    from public.regras_classificacao r
   where r.empresa_id = app.empresa_id() and r.ativa
     and (v_desc like '%' || unaccent(lower(r.termo)) || '%'
          or (r.ncm_prefixo is not null and p_ncm like r.ncm_prefixo || '%'))
   order by r.prioridade
   limit 1;

  if v_etapa is not null then
    return query
      select e.id, s.id, 'regra'::public.origem_sugestao, 0.60::numeric,
             format('Regra "%s"', v_ref)
        from public.etapas e
        left join public.subetapas s on s.etapa_id = e.id and lower(s.nome) = lower(v_sub)
       where e.obra_id = p_obra_id and lower(e.nome) = lower(v_etapa)
       limit 1;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Importa uma nota já lida (XML pelo servidor, PDF/foto pela IA).
-- p_nota: cabeçalho e totais; p_itens: [{item_numero, descricao, ...}].
-- Nota repetida (mesma chave de acesso) estoura NOTA_DUPLICADA:<id>.
-- ------------------------------------------------------------
create or replace function public.importar_nota_fiscal(
  p_obra_id  uuid,
  p_nota     jsonb,
  p_itens    jsonb
)
returns uuid
language plpgsql
security invoker            -- RLS do usuário vale em cada insert
set search_path = public, pg_temp
as $$
declare
  v_nota_id    uuid;
  v_existente  uuid;
  v_origem     public.origem_lancamento := coalesce(p_nota->>'origem', 'xml_nfe')::public.origem_lancamento;
  v_data       date := coalesce(((p_nota->>'data_emissao')::timestamptz at time zone 'America/Sao_Paulo')::date, app.hoje());
  v_numero     text := p_nota->>'numero';
  v_item       jsonb;
  v_sug        record;
  v_maior      record;
  v_soma       numeric := 0;
  v_ajuste     numeric;
  v_comp       record;
  v_qtd        integer := 0;
begin
  if not app.pode_editar_obra(p_obra_id) then
    raise exception 'Sem permissão para importar notas nesta obra';
  end if;

  if p_nota->>'chave_acesso' is not null then
    select id into v_existente from public.notas_fiscais
     where empresa_id = app.empresa_id() and chave_acesso = p_nota->>'chave_acesso';
    if v_existente is not null then
      raise exception 'NOTA_DUPLICADA:%', v_existente;
    end if;
  end if;

  insert into public.notas_fiscais (
    obra_id, chave_acesso, numero, serie, modelo, natureza_operacao, data_emissao,
    emit_cnpj, emit_nome, emit_fantasia, emit_uf, dest_documento, dest_nome,
    valor_produtos, valor_desconto, valor_frete, valor_seguro, valor_ipi,
    valor_icms_st, valor_outras, valor_total, arquivo_path, arquivo_tipo, importada_por
  ) values (
    p_obra_id, p_nota->>'chave_acesso', v_numero, p_nota->>'serie', p_nota->>'modelo',
    p_nota->>'natureza_operacao', (p_nota->>'data_emissao')::timestamptz,
    p_nota->>'emit_cnpj', p_nota->>'emit_nome', p_nota->>'emit_fantasia', p_nota->>'emit_uf',
    p_nota->>'dest_documento', p_nota->>'dest_nome',
    (p_nota->>'valor_produtos')::numeric, (p_nota->>'valor_desconto')::numeric,
    (p_nota->>'valor_frete')::numeric, (p_nota->>'valor_seguro')::numeric,
    (p_nota->>'valor_ipi')::numeric, (p_nota->>'valor_icms_st')::numeric,
    (p_nota->>'valor_outras')::numeric, (p_nota->>'valor_total')::numeric,
    p_nota->>'arquivo_path', p_nota->>'arquivo_tipo', auth.uid()
  )
  returning id into v_nota_id;

  -- Itens pelo valor bruto, cada um com a sua sugestão
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_sug from public.sugerir_classificacao(
      p_obra_id, p_nota->>'emit_cnpj', v_item->>'codigo_produto', v_item->>'ncm', v_item->>'descricao');

    insert into public.lancamentos (
      obra_id, nota_fiscal_id, componente, data_competencia, descricao,
      fornecedor_nome, fornecedor_cnpj, numero_documento, item_numero, codigo_produto,
      ncm, cfop, ean, unidade, quantidade, valor_unitario, valor_total, origem, status,
      sugestao_etapa_id, sugestao_subetapa_id, sugestao_confianca, sugestao_origem,
      sugestao_justificativa, criado_por
    ) values (
      p_obra_id, v_nota_id, 'item', v_data, v_item->>'descricao',
      p_nota->>'emit_nome', p_nota->>'emit_cnpj', v_numero,
      (v_item->>'item_numero')::smallint, v_item->>'codigo_produto',
      v_item->>'ncm', v_item->>'cfop', nullif(v_item->>'ean', 'SEM GTIN'), v_item->>'unidade',
      (v_item->>'quantidade')::numeric, (v_item->>'valor_unitario')::numeric,
      (v_item->>'valor_total')::numeric, v_origem, 'pendente',
      v_sug.etapa_id, v_sug.subetapa_id, v_sug.confianca,
      coalesce(v_sug.origem, 'nenhuma'), v_sug.justificativa, auth.uid()
    );
    v_soma := v_soma + (v_item->>'valor_total')::numeric;
    v_qtd := v_qtd + 1;
  end loop;

  -- D2: o que faz o total da nota diferir da soma dos itens vira lançamento próprio.
  -- A sugestão de etapa acompanha o item de maior valor da nota.
  select sugestao_etapa_id, sugestao_subetapa_id into v_maior
    from public.lancamentos
   where nota_fiscal_id = v_nota_id and componente = 'item'
   order by valor_total desc limit 1;

  for v_comp in
    select * from (values
      ('frete'::public.componente_lancamento,           'Frete',           (p_nota->>'valor_frete')::numeric),
      ('seguro'::public.componente_lancamento,          'Seguro',          (p_nota->>'valor_seguro')::numeric),
      ('ipi'::public.componente_lancamento,             'IPI',             (p_nota->>'valor_ipi')::numeric),
      ('icms_st'::public.componente_lancamento,         'ICMS-ST',         (p_nota->>'valor_icms_st')::numeric),
      ('outras_despesas'::public.componente_lancamento, 'Outras despesas', (p_nota->>'valor_outras')::numeric),
      ('desconto'::public.componente_lancamento,        'Desconto',        -(p_nota->>'valor_desconto')::numeric)
    ) as c(componente, rotulo, valor)
    where coalesce(c.valor, 0) <> 0
  loop
    insert into public.lancamentos (
      obra_id, nota_fiscal_id, componente, data_competencia, descricao,
      fornecedor_nome, fornecedor_cnpj, numero_documento, valor_total, origem, status,
      sugestao_etapa_id, sugestao_subetapa_id, sugestao_origem, sugestao_justificativa, criado_por
    ) values (
      p_obra_id, v_nota_id, v_comp.componente, v_data,
      format('%s da NF %s', v_comp.rotulo, coalesce(v_numero, 's/n')),
      p_nota->>'emit_nome', p_nota->>'emit_cnpj', v_numero, v_comp.valor, v_origem, 'pendente',
      v_maior.sugestao_etapa_id, v_maior.sugestao_subetapa_id,
      case when v_maior.sugestao_etapa_id is null then 'nenhuma' else 'regra' end::public.origem_sugestao,
      'Acompanha o item de maior valor da nota', auth.uid()
    );
    v_soma := v_soma + v_comp.valor;
  end loop;

  -- Sobra (II, FCP, arredondamento da leitura...) fecha a nota como ajuste
  v_ajuste := round(coalesce((p_nota->>'valor_total')::numeric, v_soma) - v_soma, 2);
  if v_ajuste <> 0 then
    insert into public.lancamentos (
      obra_id, nota_fiscal_id, componente, data_competencia, descricao,
      fornecedor_nome, fornecedor_cnpj, numero_documento, valor_total, origem, status,
      sugestao_etapa_id, sugestao_subetapa_id, sugestao_origem, sugestao_justificativa, criado_por
    ) values (
      p_obra_id, v_nota_id, 'ajuste', v_data,
      format('Ajuste para fechar o total da NF %s', coalesce(v_numero, 's/n')),
      p_nota->>'emit_nome', p_nota->>'emit_cnpj', v_numero, v_ajuste, v_origem, 'pendente',
      v_maior.sugestao_etapa_id, v_maior.sugestao_subetapa_id,
      case when v_maior.sugestao_etapa_id is null then 'nenhuma' else 'regra' end::public.origem_sugestao,
      'Diferença entre o total da nota e a soma das partes', auth.uid()
    );
  end if;

  update public.notas_fiscais set status = 'processada', quantidade_itens = v_qtd where id = v_nota_id;
  return v_nota_id;
end;
$$;

revoke execute on function public.sugerir_classificacao(uuid, text, text, text, text) from public, anon;
revoke execute on function public.importar_nota_fiscal(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.sugerir_classificacao(uuid, text, text, text, text) to authenticated, service_role;
grant  execute on function public.importar_nota_fiscal(uuid, jsonb, jsonb) to authenticated, service_role;
