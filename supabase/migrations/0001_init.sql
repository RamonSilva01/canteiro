-- ============================================================
-- Canteiro · migration inicial
-- Origem: docs/03-arquitetura.md (seções 2 e 3) do Projeto Kristian,
-- com as decisões de 04/11/2026 aplicadas:
--   D1 · "esperado para hoje" sai das datas previstas de CADA etapa
--        (não mais da janela linear da obra inteira)
--   D2 · frete, desconto, seguro, IPI etc. da NF-e NÃO são rateados:
--        viram lançamentos próprios, identificados por `componente`
--   D3 · cliente vê todos os lançamentos confirmados (transparência total)
--   D4 · economia negativa aparece (as views não zeram estouro)
-- Projeto criado com "expose new tables" DESLIGADO: os grants ficam
-- explícitos na seção 24, no fim deste arquivo.
-- ============================================================

-- ============================================================
-- 0. EXTENSÕES
-- ============================================================
create extension if not exists pg_trgm  with schema extensions;  -- similaridade de descrição (sugestão MVP)
create extension if not exists unaccent with schema extensions;  -- busca sem acento

create schema if not exists app;           -- funções internas, fora da API REST

-- ============================================================
-- 1. TIPOS
-- ============================================================
create type public.papel_usuario     as enum ('admin', 'colaborador', 'cliente');
create type public.status_obra       as enum ('planejamento', 'em_andamento', 'pausada', 'concluida', 'cancelada');
create type public.origem_lancamento as enum ('xml_nfe', 'manual');
create type public.status_lancamento as enum ('pendente', 'confirmado');
create type public.origem_sugestao   as enum ('regra', 'historico', 'ia', 'nenhuma');
create type public.tipo_post         as enum ('texto', 'foto', 'video', 'marco');
create type public.status_nfe        as enum ('recebida', 'processada', 'erro', 'duplicada');
-- D2: o que o lançamento representa dentro da nota.
--   item = produto/serviço; os demais são as diferenças entre a soma dos itens e o total da nota.
create type public.componente_lancamento as enum (
  'item', 'frete', 'desconto', 'seguro', 'ipi', 'icms_st', 'outras_despesas', 'ajuste'
);

-- ============================================================
-- 2. FUNÇÕES AUXILIARES (security definer: enxergam além da RLS,
--    o que evita recursão infinita nas políticas)
-- ============================================================

-- "Hoje" no fuso da obra. O banco roda em UTC; sem isso o dia vira às 21h.
create or replace function app.hoje()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Cast tolerante: devolve null em vez de estourar com texto inválido.
create or replace function app.uuid_ou_nulo(p_texto text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end;
$$;

-- Trigger genérico de auditoria temporal.
create or replace function app.set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ============================================================
-- 3. EMPRESAS (tenants)
-- ============================================================
create table public.empresas (
  id                uuid primary key default gen_random_uuid(),
  nome              text        not null,
  cnpj              text,
  slug              text        not null,
  logo_path         text,                       -- storage: branding (F3)
  cor_primaria      text        default '#1F2937',
  ativa             boolean     not null default true,
  criada_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint empresas_slug_uk   unique (slug),
  constraint empresas_cnpj_uk   unique (cnpj),
  constraint empresas_slug_ck   check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint empresas_cnpj_ck   check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);

-- ============================================================
-- 4. PERFIS (espelho de auth.users com papel e tenant)
-- ============================================================
create table public.perfis (
  id             uuid primary key references auth.users(id) on delete cascade,
  empresa_id     uuid not null references public.empresas(id) on delete restrict,
  papel          public.papel_usuario not null,
  nome           text not null,
  email          text not null,
  telefone       text,
  avatar_path    text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint perfis_email_ck check (position('@' in email) > 1),
  constraint perfis_id_empresa_uk unique (id, empresa_id)   -- alvo da FK de obra_membros
);

create index perfis_empresa_idx       on public.perfis (empresa_id);
create index perfis_empresa_papel_idx on public.perfis (empresa_id, papel) where ativo;
create unique index perfis_email_empresa_uk on public.perfis (empresa_id, lower(email));

-- ============================================================
-- 5. OBRAS
-- ============================================================
create table public.obras (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null references public.empresas(id) on delete cascade,
  nome                    text not null,
  codigo                  text,                  -- código interno, ex.: "PORTOBELLO-01"
  cliente_nome            text,                  -- nome de exibição do proprietário
  endereco_logradouro     text,
  endereco_numero         text,
  endereco_complemento    text,
  endereco_bairro         text,
  endereco_cidade         text,
  endereco_uf             char(2),
  endereco_cep            text,
  area_construida_m2      numeric(10,2),
  data_inicio             date,
  data_entrega_prevista   date,
  data_entrega_real       date,
  projecao_venda          numeric(14,2),
  status                  public.status_obra not null default 'planejamento',
  capa_path               text,
  criada_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  criada_por              uuid references public.perfis(id) on delete set null,
  arquivada_em            timestamptz,
  constraint obras_id_empresa_uk  unique (id, empresa_id),   -- alvo das FKs compostas
  constraint obras_codigo_uk      unique (empresa_id, codigo),
  constraint obras_uf_ck          check (endereco_uf is null or endereco_uf ~ '^[A-Z]{2}$'),
  constraint obras_datas_ck       check (
    data_entrega_prevista is null or data_inicio is null
    or data_entrega_prevista >= data_inicio
  ),
  constraint obras_projecao_ck    check (projecao_venda is null or projecao_venda >= 0)
);

create index obras_empresa_idx        on public.obras (empresa_id) where arquivada_em is null;
create index obras_empresa_status_idx on public.obras (empresa_id, status);

-- ============================================================
-- 6. VÍNCULO USUÁRIO x OBRA
-- ============================================================
create table public.obra_membros (
  id             uuid primary key default gen_random_uuid(),
  obra_id        uuid not null,
  empresa_id     uuid not null,
  usuario_id     uuid not null,
  rotulo         text,                            -- "Proprietário", "Mestre de obras"
  notificar      boolean not null default true,   -- e-mail de post novo (F2)
  vinculado_em   timestamptz not null default now(),
  vinculado_por  uuid references public.perfis(id) on delete set null,
  constraint obra_membros_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  -- o usuário vinculado tem que ser da mesma empresa da obra
  constraint obra_membros_usuario_fk
    foreign key (usuario_id, empresa_id)
    references public.perfis (id, empresa_id) on delete cascade,
  constraint obra_membros_uk unique (obra_id, usuario_id)
);

create index obra_membros_usuario_idx on public.obra_membros (usuario_id);
create index obra_membros_obra_idx    on public.obra_membros (obra_id);

-- ============================================================
-- 6.1 FUNÇÕES DE AUTORIZAÇÃO (dependem de perfis, obras e obra_membros)
-- ============================================================
create or replace function app.empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.empresa_id from public.perfis p where p.id = auth.uid() and p.ativo
$$;

create or replace function app.papel()
returns public.papel_usuario
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.papel from public.perfis p where p.id = auth.uid() and p.ativo
$$;

create or replace function app.eh_admin()
returns boolean
language sql
stable
as $$ select coalesce(app.papel() = 'admin'::public.papel_usuario, false) $$;

create or replace function app.eh_equipe()
returns boolean
language sql
stable
as $$ select coalesce(app.papel() in ('admin'::public.papel_usuario, 'colaborador'::public.papel_usuario), false) $$;

-- Leitura: admin vê tudo da empresa, colaborador e cliente veem obras vinculadas.
create or replace function app.pode_ver_obra(p_obra_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.obras o
     where o.id = p_obra_id
       and o.empresa_id = app.empresa_id()
       and (
         app.eh_admin()
         or exists (
           select 1 from public.obra_membros m
            where m.obra_id = o.id and m.usuario_id = auth.uid()
         )
       )
  )
$$;

-- Escrita operacional: admin da empresa, ou colaborador vinculado à obra.
create or replace function app.pode_editar_obra(p_obra_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.obras o
     where o.id = p_obra_id
       and o.empresa_id = app.empresa_id()
       and (
         app.eh_admin()
         or (
           app.papel() = 'colaborador'::public.papel_usuario
           and exists (
             select 1 from public.obra_membros m
              where m.obra_id = o.id and m.usuario_id = auth.uid()
           )
         )
       )
  )
$$;

-- ============================================================
-- 7. TEMPLATE PADRÃO DE ETAPAS (copiável na criação da obra)
-- ============================================================
create table public.templates_obra (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  nome           text not null,                       -- "Residencial padrão"
  descricao      text,
  eh_padrao      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint templates_obra_id_empresa_uk unique (id, empresa_id),
  constraint templates_obra_nome_uk       unique (empresa_id, nome)
);

-- Um único template padrão por empresa.
create unique index templates_obra_padrao_uk
  on public.templates_obra (empresa_id) where eh_padrao;

-- Itens do template: etapa quando pai é nulo, subetapa quando aponta para o pai.
create table public.template_itens (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null,
  empresa_id          uuid not null,
  item_pai_id         uuid references public.template_itens(id) on delete cascade,
  nome                text not null,               -- "Fundação e estrutura", "Aço"
  ordem               smallint not null default 0,
  peso_percentual     numeric(5,2),                -- fatia sugerida do orçamento total
  orcamento_sugerido  numeric(14,2),               -- alternativa em valor absoluto
  duracao_dias        smallint,                    -- D1: sugestão de prazo da etapa
  constraint template_itens_tpl_fk
    foreign key (template_id, empresa_id)
    references public.templates_obra (id, empresa_id) on delete cascade,
  constraint template_itens_id_tpl_uk unique (id, template_id),
  constraint template_itens_peso_ck   check (peso_percentual is null or peso_percentual between 0 and 100),
  constraint template_itens_orc_ck    check (orcamento_sugerido is null or orcamento_sugerido >= 0),
  constraint template_itens_dur_ck    check (duracao_dias is null or duracao_dias > 0)
);

create index template_itens_template_idx on public.template_itens (template_id, ordem);
create index template_itens_pai_idx      on public.template_itens (item_pai_id);

-- ============================================================
-- 8. ETAPAS DA OBRA
-- D1: data_inicio_prevista e data_fim_prevista são a base do
--     "esperado para hoje" e do status adiantada/no prazo/atrasada.
-- ============================================================
create table public.etapas (
  id                    uuid primary key default gen_random_uuid(),
  obra_id               uuid not null,
  empresa_id            uuid not null,
  template_item_id      uuid references public.template_itens(id) on delete set null,
  nome                  text not null,
  ordem                 smallint not null default 0,
  orcamento_referencia  numeric(14,2) not null default 0,
  percentual_avanco     numeric(5,2)  not null default 0,   -- cache do último avanço
  data_inicio_prevista  date,
  data_fim_prevista     date,
  data_inicio_real      date,
  data_fim_real         date,
  observacoes           text,
  criada_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint etapas_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint etapas_id_obra_uk    unique (id, obra_id),
  constraint etapas_nome_uk       unique (obra_id, nome),
  constraint etapas_orcamento_ck  check (orcamento_referencia >= 0),
  constraint etapas_avanco_ck     check (percentual_avanco between 0 and 100),
  constraint etapas_datas_ck      check (
    data_fim_prevista is null or data_inicio_prevista is null
    or data_fim_prevista >= data_inicio_prevista
  )
);

create index etapas_obra_idx on public.etapas (obra_id, ordem);

-- ============================================================
-- 9. SUBETAPAS
-- ============================================================
create table public.subetapas (
  id                    uuid primary key default gen_random_uuid(),
  etapa_id              uuid not null,
  obra_id               uuid not null,
  empresa_id            uuid not null,
  template_item_id      uuid references public.template_itens(id) on delete set null,
  nome                  text not null,                 -- "Aço", "Concreto", "Forma"
  ordem                 smallint not null default 0,
  orcamento_referencia  numeric(14,2) not null default 0,
  criada_em             timestamptz not null default now(),
  constraint subetapas_etapa_fk
    foreign key (etapa_id, obra_id)
    references public.etapas (id, obra_id) on delete cascade,
  constraint subetapas_id_etapa_uk unique (id, etapa_id),  -- alvo da FK de lancamentos
  constraint subetapas_nome_uk     unique (etapa_id, nome),
  constraint subetapas_orcamento_ck check (orcamento_referencia >= 0)
);

create index subetapas_etapa_idx on public.subetapas (etapa_id, ordem);

-- ============================================================
-- 10. NOTAS FISCAIS IMPORTADAS (cabeçalho da NF-e)
-- ============================================================
create table public.notas_fiscais (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null,
  obra_id              uuid not null,
  chave_acesso         char(44),                  -- nulo para nota lida de PDF/foto sem chave
  numero               text,
  serie                text,
  modelo               text,                      -- 55 = NF-e, 65 = NFC-e
  natureza_operacao    text,
  data_emissao         timestamptz,
  emit_cnpj            text,
  emit_nome            text,
  emit_fantasia        text,
  emit_uf              char(2),
  dest_documento       text,                      -- CNPJ ou CPF do destinatário
  dest_nome            text,
  -- totais do grupo ICMSTot; cada um que for > 0 vira lançamento próprio (D2)
  valor_produtos       numeric(14,2),             -- vProd
  valor_desconto       numeric(14,2),             -- vDesc
  valor_frete          numeric(14,2),             -- vFrete
  valor_seguro         numeric(14,2),             -- vSeg
  valor_ipi            numeric(14,2),             -- vIPI
  valor_icms_st        numeric(14,2),             -- vST
  valor_outras         numeric(14,2),             -- vOutro
  valor_total          numeric(14,2),             -- vNF
  quantidade_itens     smallint not null default 0,
  arquivo_path         text,                      -- bucket nfe-xml (XML, PDF ou foto original)
  arquivo_tipo         text,                      -- 'xml' | 'pdf' | 'imagem'
  status               public.status_nfe not null default 'recebida',
  erro_processamento   text,
  importada_por        uuid references public.perfis(id) on delete set null,
  importada_em         timestamptz not null default now(),
  constraint notas_fiscais_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint notas_fiscais_id_empresa_uk unique (id, empresa_id),
  constraint notas_fiscais_chave_uk      unique (empresa_id, chave_acesso),  -- idempotência
  constraint notas_fiscais_chave_ck      check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$'),
  constraint notas_fiscais_emit_ck       check (emit_cnpj is null or emit_cnpj ~ '^[0-9]{14}$'),
  constraint notas_fiscais_tipo_ck       check (arquivo_tipo is null or arquivo_tipo in ('xml', 'pdf', 'imagem'))
);

create index notas_fiscais_obra_idx   on public.notas_fiscais (obra_id, data_emissao desc);
create index notas_fiscais_status_idx on public.notas_fiscais (empresa_id, status) where status <> 'processada';

-- ============================================================
-- 11. LANÇAMENTOS (coração do sistema)
-- D2: item entra pelo valor bruto (vProd). Desconto, frete e demais
--     diferenças da nota são lançamentos separados (`componente`),
--     então a soma dos lançamentos da nota sempre fecha com o vNF.
-- ============================================================
create table public.lancamentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null,
  obra_id               uuid not null,
  etapa_id              uuid,                     -- nulo enquanto pendente
  subetapa_id           uuid,
  nota_fiscal_id        uuid,
  componente            public.componente_lancamento not null default 'item',
  -- dados do documento
  data_competencia      date not null,            -- data da compra ou emissão
  descricao             text not null,            -- xProd, "Frete da NF 1234" ou texto digitado
  fornecedor_nome       text,
  fornecedor_cnpj       text,
  numero_documento      text,                     -- número da NF ou recibo
  -- campos vindos do item da NF-e (det/prod)
  item_numero           smallint,                 -- det @nItem
  codigo_produto        text,                     -- cProd
  ncm                   text,
  cfop                  text,
  ean                   text,                     -- cEAN
  unidade               text,                     -- uCom
  quantidade            numeric(14,4),            -- qCom
  valor_unitario        numeric(14,6),            -- vUnCom (6 casas, padrão SEFAZ)
  valor_total           numeric(14,2) not null,   -- vProd do item, ou valor do componente
  -- controle
  origem                public.origem_lancamento not null,
  status                public.status_lancamento not null default 'pendente',
  observacoes           text,
  -- sugestão de classificação
  sugestao_etapa_id     uuid,
  sugestao_subetapa_id  uuid,
  sugestao_confianca    numeric(4,3),
  sugestao_origem       public.origem_sugestao not null default 'nenhuma',
  sugestao_justificativa text,
  -- trilha
  criado_por            uuid references public.perfis(id) on delete set null,
  criado_em             timestamptz not null default now(),
  confirmado_por        uuid references public.perfis(id) on delete set null,
  confirmado_em         timestamptz,
  atualizado_em         timestamptz not null default now(),
  excluido_em           timestamptz,              -- descarte lógico, preserva auditoria
  excluido_por          uuid references public.perfis(id) on delete set null,

  constraint lancamentos_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint lancamentos_etapa_fk
    foreign key (etapa_id, obra_id)
    references public.etapas (id, obra_id) on delete restrict,
  -- garante que a subetapa pertence à etapa escolhida (MATCH SIMPLE ignora quando há nulo)
  constraint lancamentos_subetapa_fk
    foreign key (subetapa_id, etapa_id)
    references public.subetapas (id, etapa_id) on delete restrict,
  constraint lancamentos_nfe_fk
    foreign key (nota_fiscal_id, empresa_id)
    references public.notas_fiscais (id, empresa_id) on delete set null,
  constraint lancamentos_sug_etapa_fk
    foreign key (sugestao_etapa_id, obra_id)
    references public.etapas (id, obra_id) on delete set null,

  -- desconto subtrai, ajuste (arredondamento) pode ir para os dois lados, o resto soma
  constraint lancamentos_valor_ck check (
    case componente
      when 'desconto' then valor_total <= 0
      when 'ajuste'   then true
      else valor_total >= 0
    end
  ),
  constraint lancamentos_qtd_ck        check (quantidade is null or quantidade >= 0),
  constraint lancamentos_confianca_ck  check (sugestao_confianca is null or sugestao_confianca between 0 and 1),
  -- regra de ouro: confirmado obriga etapa e autoria
  constraint lancamentos_confirmado_ck check (
    status = 'pendente'
    or (etapa_id is not null and confirmado_em is not null and confirmado_por is not null)
  ),
  -- origem xml exige vínculo com a nota
  constraint lancamentos_origem_ck check (
    origem = 'manual' or nota_fiscal_id is not null
  )
);

-- Idempotência de item: a mesma nota não gera o mesmo item duas vezes.
create unique index lancamentos_nfe_item_uk
  on public.lancamentos (nota_fiscal_id, item_numero)
  where nota_fiscal_id is not null and item_numero is not null;

-- Idempotência de componente: um frete, um desconto etc. por nota.
create unique index lancamentos_nfe_componente_uk
  on public.lancamentos (nota_fiscal_id, componente)
  where nota_fiscal_id is not null and componente <> 'item' and excluido_em is null;

create index lancamentos_obra_data_idx
  on public.lancamentos (obra_id, data_competencia desc)
  where excluido_em is null;

create index lancamentos_pendentes_idx
  on public.lancamentos (obra_id, criado_em desc)
  where status = 'pendente' and excluido_em is null;

create index lancamentos_etapa_idx
  on public.lancamentos (etapa_id)
  where status = 'confirmado' and excluido_em is null;

create index lancamentos_subetapa_idx
  on public.lancamentos (subetapa_id)
  where status = 'confirmado' and excluido_em is null;

create index lancamentos_fornecedor_idx
  on public.lancamentos (empresa_id, fornecedor_cnpj)
  where excluido_em is null;

-- Suporte à sugestão por histórico (similaridade textual da descrição).
create index lancamentos_descricao_trgm_idx
  on public.lancamentos using gin (descricao extensions.gin_trgm_ops);

-- ============================================================
-- 12. REGRAS DETERMINÍSTICAS DE CLASSIFICAÇÃO (sugestão da F1)
-- ============================================================
create table public.regras_classificacao (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  termo          text not null,               -- "cimento", "vergalhao", "ca-50"
  ncm_prefixo    text,                        -- alternativa por NCM, ex.: "2523"
  etapa_nome     text not null,               -- casado por nome na obra alvo
  subetapa_nome  text,
  prioridade     smallint not null default 100,
  ativa          boolean not null default true,
  criada_em      timestamptz not null default now(),
  constraint regras_termo_uk check (length(termo) >= 3)
);

create index regras_classificacao_empresa_idx
  on public.regras_classificacao (empresa_id, prioridade) where ativa;

-- ============================================================
-- 13. HISTÓRICO DE AVANÇO FÍSICO (append-only)
-- ============================================================
create table public.avancos_etapa (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  obra_id          uuid not null,
  etapa_id         uuid not null,
  percentual       numeric(5,2) not null,
  data_referencia  date not null default app.hoje(),
  observacao       text,
  registrado_por   uuid references public.perfis(id) on delete set null,
  registrado_em    timestamptz not null default now(),
  constraint avancos_etapa_fk
    foreign key (etapa_id, obra_id)
    references public.etapas (id, obra_id) on delete cascade,
  constraint avancos_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint avancos_percentual_ck check (percentual between 0 and 100),
  -- um registro por etapa por dia (reenvio no mesmo dia é correção, ver upsert)
  constraint avancos_etapa_dia_uk unique (etapa_id, data_referencia)
);

create index avancos_etapa_idx on public.avancos_etapa (etapa_id, data_referencia desc);
create index avancos_obra_idx  on public.avancos_etapa (obra_id, data_referencia desc);

-- ============================================================
-- 14. POSTS
-- ============================================================
create table public.posts (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  obra_id          uuid not null,
  etapa_id         uuid,                          -- post ancorado numa etapa (opcional)
  autor_id         uuid references public.perfis(id) on delete set null,
  tipo             public.tipo_post not null default 'foto',
  titulo           text,
  texto            text,
  visivel_cliente  boolean not null default true,
  publicado_em     timestamptz,                   -- nulo = rascunho
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  excluido_em      timestamptz,
  constraint posts_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint posts_etapa_fk
    foreign key (etapa_id, obra_id)
    references public.etapas (id, obra_id) on delete set null,
  constraint posts_id_obra_uk unique (id, obra_id),
  constraint posts_conteudo_ck check (
    coalesce(titulo, '') <> '' or coalesce(texto, '') <> '' or tipo in ('foto', 'video')
  )
);

create index posts_obra_feed_idx
  on public.posts (obra_id, publicado_em desc)
  where excluido_em is null and publicado_em is not null;

-- ============================================================
-- 15. MÍDIAS DO POST (arquivos no Storage)
-- ============================================================
create table public.post_midias (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null,
  obra_id        uuid not null,
  empresa_id     uuid not null,
  storage_path   text not null,                 -- bucket obra-fotos
  mime_type      text not null,
  tamanho_bytes  integer,
  largura        integer,
  altura         integer,
  legenda        text,
  ordem          smallint not null default 0,
  criada_em      timestamptz not null default now(),
  constraint post_midias_post_fk
    foreign key (post_id, obra_id)
    references public.posts (id, obra_id) on delete cascade,
  constraint post_midias_path_uk unique (storage_path),
  constraint post_midias_tamanho_ck check (tamanho_bytes is null or tamanho_bytes <= 26214400) -- 25 MB
);

create index post_midias_post_idx on public.post_midias (post_id, ordem);

-- ============================================================
-- 16. COMENTÁRIOS (uma resposta de profundidade, sem árvore infinita)
-- ============================================================
create table public.comentarios (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null,
  obra_id            uuid not null,
  empresa_id         uuid not null,
  autor_id           uuid not null references public.perfis(id) on delete cascade,
  comentario_pai_id  uuid references public.comentarios(id) on delete cascade,
  texto              text not null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  excluido_em        timestamptz,
  constraint comentarios_post_fk
    foreign key (post_id, obra_id)
    references public.posts (id, obra_id) on delete cascade,
  constraint comentarios_texto_ck check (length(btrim(texto)) between 1 and 4000)
);

create index comentarios_post_idx on public.comentarios (post_id, criado_em) where excluido_em is null;

-- ============================================================
-- 17. CURTIDAS
-- ============================================================
create table public.curtidas (
  post_id     uuid not null,
  obra_id     uuid not null,
  empresa_id  uuid not null,
  usuario_id  uuid not null references public.perfis(id) on delete cascade,
  criada_em   timestamptz not null default now(),
  primary key (post_id, usuario_id),
  constraint curtidas_post_fk
    foreign key (post_id, obra_id)
    references public.posts (id, obra_id) on delete cascade
);

-- ============================================================
-- 18. RELATÓRIOS MENSAIS (snapshot congelado)
-- ============================================================
create table public.relatorios_mensais (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null,
  obra_id        uuid not null,
  competencia    date not null,              -- sempre dia 1 do mês de referência
  dados          jsonb not null,             -- snapshot completo do dashboard
  resumo         text,                       -- texto de abertura escrito pelo admin
  pdf_path       text,                       -- bucket relatorios
  gerado_por     uuid references public.perfis(id) on delete set null,
  gerado_em      timestamptz not null default now(),
  publicado_em   timestamptz,                -- nulo = ainda invisível ao cliente
  constraint relatorios_obra_fk
    foreign key (obra_id, empresa_id)
    references public.obras (id, empresa_id) on delete cascade,
  constraint relatorios_competencia_uk unique (obra_id, competencia),
  constraint relatorios_competencia_ck check (extract(day from competencia) = 1)
);

create index relatorios_obra_idx
  on public.relatorios_mensais (obra_id, competencia desc);

-- ============================================================
-- 19. TRILHA DE AUDITORIA (leve, só eventos sensíveis)
-- ============================================================
create table public.eventos_auditoria (
  id           bigserial primary key,
  empresa_id   uuid not null,
  obra_id      uuid,
  usuario_id   uuid,
  acao         text not null,     -- 'lancamento.confirmado', 'obra.orcamento_alterado'
  entidade     text not null,
  entidade_id  uuid,
  detalhe      jsonb,
  criado_em    timestamptz not null default now()
);

create index eventos_auditoria_idx on public.eventos_auditoria (empresa_id, criado_em desc);

-- ============================================================
-- 20. TRIGGERS
-- ============================================================

-- 20.1 atualizado_em automático
create trigger empresas_touch      before update on public.empresas       for each row execute function app.set_atualizado_em();
create trigger perfis_touch        before update on public.perfis         for each row execute function app.set_atualizado_em();
create trigger obras_touch         before update on public.obras          for each row execute function app.set_atualizado_em();
create trigger templates_touch     before update on public.templates_obra for each row execute function app.set_atualizado_em();
create trigger etapas_touch        before update on public.etapas         for each row execute function app.set_atualizado_em();
create trigger lancamentos_touch   before update on public.lancamentos    for each row execute function app.set_atualizado_em();
create trigger posts_touch         before update on public.posts          for each row execute function app.set_atualizado_em();
create trigger comentarios_touch   before update on public.comentarios    for each row execute function app.set_atualizado_em();

-- 20.2 Preenche empresa_id a partir da obra, para o cliente nunca precisar mandar
create or replace function app.herdar_empresa_da_obra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_empresa uuid;
begin
  select o.empresa_id into v_empresa from public.obras o where o.id = new.obra_id;
  if v_empresa is null then
    raise exception 'Obra % inexistente', new.obra_id;
  end if;
  new.empresa_id := v_empresa;
  return new;
end;
$$;

create trigger etapas_empresa        before insert or update of obra_id on public.etapas             for each row execute function app.herdar_empresa_da_obra();
create trigger lancamentos_empresa   before insert or update of obra_id on public.lancamentos        for each row execute function app.herdar_empresa_da_obra();
create trigger avancos_empresa       before insert or update of obra_id on public.avancos_etapa      for each row execute function app.herdar_empresa_da_obra();
create trigger posts_empresa         before insert or update of obra_id on public.posts              for each row execute function app.herdar_empresa_da_obra();
create trigger notas_empresa         before insert or update of obra_id on public.notas_fiscais      for each row execute function app.herdar_empresa_da_obra();
create trigger obra_membros_empresa  before insert or update of obra_id on public.obra_membros       for each row execute function app.herdar_empresa_da_obra();
create trigger comentarios_empresa   before insert or update of obra_id on public.comentarios        for each row execute function app.herdar_empresa_da_obra();
create trigger post_midias_empresa   before insert or update of obra_id on public.post_midias        for each row execute function app.herdar_empresa_da_obra();
create trigger curtidas_empresa      before insert or update of obra_id on public.curtidas           for each row execute function app.herdar_empresa_da_obra();
create trigger subetapas_empresa     before insert or update of obra_id on public.subetapas          for each row execute function app.herdar_empresa_da_obra();
create trigger relatorios_empresa    before insert or update of obra_id on public.relatorios_mensais for each row execute function app.herdar_empresa_da_obra();

-- 20.3 Cache do percentual de avanço na etapa
create or replace function app.sincronizar_avanco_etapa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.etapas e
     set percentual_avanco = (
           select a.percentual
             from public.avancos_etapa a
            where a.etapa_id = e.id
            order by a.data_referencia desc, a.registrado_em desc
            limit 1
         ),
         data_inicio_real = coalesce(e.data_inicio_real,
           case when new.percentual > 0 then new.data_referencia end),
         data_fim_real = case when new.percentual >= 100 then new.data_referencia else null end
   where e.id = new.etapa_id;
  return null;
end;
$$;

create trigger avancos_sincroniza
  after insert or update on public.avancos_etapa
  for each row execute function app.sincronizar_avanco_etapa();

-- 20.4 Carimbo de confirmação do lançamento
-- Vale no update (pendente -> confirmado) e no insert: lançamento manual
-- digitado pela equipe já nasce confirmado.
create or replace function app.carimbar_confirmacao()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'confirmado' and (tg_op = 'INSERT' or old.status = 'pendente') then
    new.confirmado_por := coalesce(new.confirmado_por, auth.uid());
    new.confirmado_em  := coalesce(new.confirmado_em, now());
  end if;
  return new;
end;
$$;

create trigger lancamentos_confirmacao
  before insert or update on public.lancamentos
  for each row execute function app.carimbar_confirmacao();

-- 20.5 Ninguém se promove: papel e empresa só mudam por admin (ou service_role)
create or replace function app.proteger_papel()
returns trigger
language plpgsql
as $$
begin
  if (new.papel is distinct from old.papel or new.empresa_id is distinct from old.empresa_id)
     and auth.uid() is not null
     and not app.eh_admin() then
    raise exception 'Alteração de papel ou empresa exige perfil de administrador';
  end if;
  return new;
end;
$$;

create trigger perfis_protege_papel
  before update on public.perfis
  for each row execute function app.proteger_papel();

-- ============================================================
-- 21. VIEWS (security_invoker garante que a RLS do usuário se aplica)
-- ============================================================

-- Por etapa: a lógica da aba Acompanhamento do Excel.
-- D1: avanco_esperado é a posição de hoje dentro da janela prevista da etapa.
-- D4: economia negativa (estouro) é mantida, não zerada.
create or replace view public.vw_etapas_consolidadas
with (security_invoker = true) as
with base as (
  select
    e.id                                     as etapa_id,
    e.obra_id,
    e.empresa_id,
    e.nome,
    e.ordem,
    e.orcamento_referencia,
    e.percentual_avanco,
    e.data_inicio_prevista,
    e.data_fim_prevista,
    e.data_inicio_real,
    e.data_fim_real,
    coalesce(r.custo_real, 0)                as custo_real,
    round(e.orcamento_referencia * e.percentual_avanco / 100, 2) as custo_projetado,
    case
      when e.percentual_avanco >= 100
        then e.orcamento_referencia - coalesce(r.custo_real, 0)
      else round(e.orcamento_referencia * e.percentual_avanco / 100, 2) - coalesce(r.custo_real, 0)
    end                                      as economia,
    coalesce(r.qtd_lancamentos, 0)           as qtd_lancamentos,
    case
      -- dias inteiros já passados / dias da janela (início e fim inclusos)
      when e.data_inicio_prevista is null or e.data_fim_prevista is null then null
      when app.hoje() > e.data_fim_prevista     then 100::numeric
      when app.hoje() <= e.data_inicio_prevista then 0::numeric
      else round(100.0 * (app.hoje() - e.data_inicio_prevista)
                 / (e.data_fim_prevista - e.data_inicio_prevista + 1), 2)
    end                                      as avanco_esperado
  from public.etapas e
  left join lateral (
    select sum(l.valor_total) as custo_real, count(*) as qtd_lancamentos
      from public.lancamentos l
     where l.etapa_id = e.id
       and l.status = 'confirmado'
       and l.excluido_em is null
  ) r on true
)
select
  b.*,
  case
    when b.avanco_esperado is null                        then 'sem_prazo'
    when b.percentual_avanco - b.avanco_esperado >= 5     then 'adiantada'
    when b.percentual_avanco - b.avanco_esperado <= -5    then 'atrasada'
    else 'no_prazo'
  end as situacao_prazo
from base b;

-- Por obra: a lógica da aba Dashboard do Excel.
-- D1: o esperado da obra é a média ponderada (pelo orçamento) do esperado das
-- etapas COM datas previstas, comparada ao avanço real dessas mesmas etapas.
create or replace view public.vw_obras_consolidadas
with (security_invoker = true) as
with base as (
  select
    o.id, o.empresa_id, o.nome, o.status, o.data_inicio, o.data_entrega_prevista,
    o.projecao_venda,
    coalesce(sum(v.orcamento_referencia), 0)             as orcamento_total,
    coalesce(sum(v.custo_real), 0)                       as custo_real_total,
    coalesce(sum(v.custo_projetado), 0)                  as custo_projetado_total,
    coalesce(sum(v.economia), 0)                         as economia_total,
    case when sum(v.orcamento_referencia) > 0
         then round(sum(v.orcamento_referencia * v.percentual_avanco)
                    / sum(v.orcamento_referencia), 2)
         else 0 end                                      as avanco_geral,
    round(
      sum(v.orcamento_referencia * v.avanco_esperado) filter (where v.avanco_esperado is not null)
      / nullif(sum(v.orcamento_referencia) filter (where v.avanco_esperado is not null), 0), 2
    )                                                    as avanco_esperado,
    round(
      sum(v.orcamento_referencia * v.percentual_avanco) filter (where v.avanco_esperado is not null)
      / nullif(sum(v.orcamento_referencia) filter (where v.avanco_esperado is not null), 0), 2
    )                                                    as avanco_real_planejado,
    count(v.etapa_id) filter (where v.avanco_esperado is null) as etapas_sem_prazo
  from public.obras o
  left join public.vw_etapas_consolidadas v on v.obra_id = o.id
  where o.arquivada_em is null
  group by o.id, o.empresa_id, o.nome, o.status, o.data_inicio,
           o.data_entrega_prevista, o.projecao_venda
)
select
  b.*,
  case
    when b.avanco_esperado is null                            then 'sem_prazo'
    when b.avanco_real_planejado - b.avanco_esperado >= 5     then 'adiantada'
    when b.avanco_real_planejado - b.avanco_esperado <= -5    then 'atrasada'
    else 'no_prazo'
  end as situacao_prazo
from base b;

-- D2: conferência da nota. diferenca <> 0 significa que falta lançar
-- algum componente (frete, desconto...) ou que um lançamento foi excluído.
create or replace view public.vw_notas_conferencia
with (security_invoker = true) as
select
  n.id            as nota_fiscal_id,
  n.obra_id,
  n.empresa_id,
  n.numero,
  n.emit_nome,
  n.data_emissao,
  n.valor_total   as valor_nota,
  coalesce(sum(l.valor_total), 0)                     as valor_lancado,
  coalesce(n.valor_total, 0) - coalesce(sum(l.valor_total), 0) as diferenca,
  count(l.id) filter (where l.status = 'pendente')    as qtd_pendentes
from public.notas_fiscais n
left join public.lancamentos l
       on l.nota_fiscal_id = n.id and l.excluido_em is null
group by n.id;

-- ============================================================
-- 22. COPIAR TEMPLATE PARA UMA OBRA NOVA
-- D1: se o template tiver duracao_dias e a obra tiver data_inicio,
-- as etapas já nascem com datas previstas em sequência (o admin ajusta depois).
-- ============================================================
create or replace function public.aplicar_template_na_obra(
  p_obra_id      uuid,
  p_template_id  uuid,
  p_orcamento_total numeric default null   -- se informado, distribui pelo peso_percentual
)
returns integer
language plpgsql
security invoker            -- a RLS do usuário continua valendo
set search_path = public, pg_temp
as $$
declare
  v_criadas integer := 0;
  v_etapa   record;
  v_novo_id uuid;
  v_cursor  date;
begin
  if not app.pode_editar_obra(p_obra_id) then
    raise exception 'Sem permissão para editar a obra %', p_obra_id;
  end if;

  select o.data_inicio into v_cursor from public.obras o where o.id = p_obra_id;

  for v_etapa in
    select * from public.template_itens
     where template_id = p_template_id and item_pai_id is null
     order by ordem
  loop
    insert into public.etapas (
      obra_id, template_item_id, nome, ordem, orcamento_referencia,
      data_inicio_prevista, data_fim_prevista
    )
    values (
      p_obra_id, v_etapa.id, v_etapa.nome, v_etapa.ordem,
      coalesce(
        v_etapa.orcamento_sugerido,
        round(coalesce(p_orcamento_total, 0) * coalesce(v_etapa.peso_percentual, 0) / 100, 2)
      ),
      case when v_cursor is not null and v_etapa.duracao_dias is not null then v_cursor end,
      case when v_cursor is not null and v_etapa.duracao_dias is not null
           then v_cursor + v_etapa.duracao_dias - 1 end
    )
    returning id into v_novo_id;

    if v_cursor is not null and v_etapa.duracao_dias is not null then
      v_cursor := v_cursor + v_etapa.duracao_dias;
    end if;

    v_criadas := v_criadas + 1;

    insert into public.subetapas (etapa_id, obra_id, template_item_id, nome, ordem, orcamento_referencia)
    select v_novo_id, p_obra_id, ti.id, ti.nome, ti.ordem, coalesce(ti.orcamento_sugerido, 0)
      from public.template_itens ti
     where ti.item_pai_id = v_etapa.id
     order by ti.ordem;
  end loop;

  return v_criadas;
end;
$$;

-- ============================================================
-- 23. RLS
-- ============================================================
alter table public.empresas             enable row level security;
alter table public.perfis               enable row level security;
alter table public.obras                enable row level security;
alter table public.obra_membros         enable row level security;
alter table public.templates_obra       enable row level security;
alter table public.template_itens       enable row level security;
alter table public.etapas               enable row level security;
alter table public.subetapas            enable row level security;
alter table public.notas_fiscais        enable row level security;
alter table public.lancamentos          enable row level security;
alter table public.regras_classificacao enable row level security;
alter table public.avancos_etapa        enable row level security;
alter table public.posts                enable row level security;
alter table public.post_midias          enable row level security;
alter table public.comentarios          enable row level security;
alter table public.curtidas             enable row level security;
alter table public.relatorios_mensais   enable row level security;
alter table public.eventos_auditoria    enable row level security;

-- 23.1 EMPRESAS: leio a minha, só admin edita, criação e remoção só por service_role.
create policy empresas_select on public.empresas
  for select to authenticated
  using (id = app.empresa_id());

create policy empresas_update on public.empresas
  for update to authenticated
  using (id = app.empresa_id() and app.eh_admin())
  with check (id = app.empresa_id() and app.eh_admin());

-- 23.2 PERFIS: vejo a mim mesmo sempre; equipe vê a empresa inteira;
-- cliente vê apenas quem compartilha obra com ele (autores de post e comentário).
create policy perfis_select on public.perfis
  for select to authenticated
  using (
    id = auth.uid()
    or (
      empresa_id = app.empresa_id()
      and (
        app.eh_equipe()
        or exists (
          select 1
            from public.obra_membros meu
            join public.obra_membros outro on outro.obra_id = meu.obra_id
           where meu.usuario_id = auth.uid()
             and outro.usuario_id = public.perfis.id
        )
      )
    )
  );

create policy perfis_update_proprio on public.perfis
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and empresa_id = app.empresa_id());

create policy perfis_update_admin on public.perfis
  for update to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

-- 23.3 OBRAS E VÍNCULOS
create policy obras_select on public.obras
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(id));

create policy obras_insert on public.obras
  for insert to authenticated
  with check (empresa_id = app.empresa_id() and app.eh_admin());

create policy obras_update on public.obras
  for update to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

create policy obras_delete on public.obras
  for delete to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin());

create policy obra_membros_select on public.obra_membros
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(obra_id));

create policy obra_membros_admin_write on public.obra_membros
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

-- 23.4 TEMPLATES, ETAPAS E SUBETAPAS
create policy templates_select on public.templates_obra
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.eh_equipe());

create policy templates_write on public.templates_obra
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

create policy template_itens_select on public.template_itens
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.eh_equipe());

create policy template_itens_write on public.template_itens
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

create policy etapas_select on public.etapas
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(obra_id));

create policy etapas_write_admin on public.etapas
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id));

create policy subetapas_select on public.subetapas
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(obra_id));

create policy subetapas_write_admin on public.subetapas
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id));

-- 23.5 LANÇAMENTOS E NOTAS FISCAIS
-- D3: cliente vê todo lançamento confirmado e não excluído (transparência total);
-- pendente é rascunho da equipe.
create policy lancamentos_select on public.lancamentos
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and (
      app.eh_equipe()
      or (status = 'confirmado' and excluido_em is null)
    )
  );

create policy lancamentos_insert on public.lancamentos
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and app.pode_editar_obra(obra_id)
  );

create policy lancamentos_update on public.lancamentos
  for update to authenticated
  using (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

-- Remoção física é privilégio de admin; o fluxo normal é descarte lógico (excluido_em).
create policy lancamentos_delete on public.lancamentos
  for delete to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id));

-- Documento fiscal bruto é assunto da equipe; o cliente enxerga pelos lançamentos.
create policy notas_fiscais_select on public.notas_fiscais
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.eh_equipe() and app.pode_ver_obra(obra_id));

create policy notas_fiscais_write on public.notas_fiscais
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

create policy regras_select on public.regras_classificacao
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.eh_equipe());

create policy regras_write on public.regras_classificacao
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin())
  with check (empresa_id = app.empresa_id() and app.eh_admin());

-- 23.6 AVANÇO FÍSICO
create policy avancos_select on public.avancos_etapa
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(obra_id));

create policy avancos_insert on public.avancos_etapa
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and app.pode_editar_obra(obra_id)
    and registrado_por = auth.uid()
  );

-- Correção do dia é permitida à equipe; histórico de dias anteriores só admin mexe.
create policy avancos_update on public.avancos_etapa
  for update to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_editar_obra(obra_id)
    and (app.eh_admin() or data_referencia = app.hoje())
  )
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

-- 23.7 FEED
create policy posts_select on public.posts
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and (
      app.eh_equipe()
      or (visivel_cliente and publicado_em is not null and excluido_em is null)
    )
  );

create policy posts_insert on public.posts
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and app.pode_editar_obra(obra_id)
    and autor_id = auth.uid()
  );

create policy posts_update on public.posts
  for update to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_editar_obra(obra_id)
    and (app.eh_admin() or autor_id = auth.uid())
  )
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

create policy post_midias_select on public.post_midias
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and exists (
      select 1 from public.posts p
       where p.id = post_midias.post_id
         and app.pode_ver_obra(p.obra_id)
         and (app.eh_equipe() or (p.visivel_cliente and p.publicado_em is not null and p.excluido_em is null))
    )
  );

create policy post_midias_write on public.post_midias
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

create policy comentarios_select on public.comentarios
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and excluido_em is null
    and exists (
      select 1 from public.posts p
       where p.id = comentarios.post_id
         and (app.eh_equipe() or (p.visivel_cliente and p.publicado_em is not null))
    )
  );

create policy comentarios_insert on public.comentarios
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and autor_id = auth.uid()
    and exists (
      select 1 from public.posts p
       where p.id = comentarios.post_id
         and p.excluido_em is null
         and (app.eh_equipe() or (p.visivel_cliente and p.publicado_em is not null))
    )
  );

create policy comentarios_update on public.comentarios
  for update to authenticated
  using (
    empresa_id = app.empresa_id()
    and (autor_id = auth.uid() or app.eh_admin())
  )
  with check (empresa_id = app.empresa_id());

create policy curtidas_select on public.curtidas
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.pode_ver_obra(obra_id));

create policy curtidas_insert on public.curtidas
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and usuario_id = auth.uid()
  );

create policy curtidas_delete on public.curtidas
  for delete to authenticated
  using (empresa_id = app.empresa_id() and usuario_id = auth.uid());

-- 23.8 RELATÓRIOS E AUDITORIA
create policy relatorios_select on public.relatorios_mensais
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and app.pode_ver_obra(obra_id)
    and (app.eh_equipe() or publicado_em is not null)
  );

create policy relatorios_write on public.relatorios_mensais
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.eh_admin() and app.pode_ver_obra(obra_id));

-- Auditoria: leitura só de admin, escrita só por service_role (nenhuma policy de insert).
create policy auditoria_select on public.eventos_auditoria
  for select to authenticated
  using (empresa_id = app.empresa_id() and app.eh_admin());

-- ============================================================
-- 24. GRANTS EXPLÍCITOS
-- O projeto foi criado com "Automatically expose new tables" desligado,
-- então nenhum papel enxerga tabela nenhuma até receber grant aqui.
-- anon fica sem nada: todo acesso a dado exige login.
-- ============================================================
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Funções de app.* rodam dentro das políticas, então quem consulta precisa poder executá-las.
-- O schema app não é exposto na API REST.
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.aplicar_template_na_obra(uuid, uuid, numeric) from public, anon;
grant  execute on function public.aplicar_template_na_obra(uuid, uuid, numeric) to authenticated, service_role;

-- ============================================================
-- 25. STORAGE (buckets privados + políticas)
-- Convenção de caminho: {empresa_id}/{obra_id}/...
-- storage.foldername(name) devolve as pastas do caminho, 1-based.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('obra-fotos', 'obra-fotos', false, 26214400,
     array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']),
  ('nfe-xml',    'nfe-xml',    false, 10485760,
     array['application/xml', 'text/xml', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('relatorios', 'relatorios', false, 10485760,
     array['application/pdf'])
on conflict (id) do nothing;

create policy fotos_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'obra-fotos'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and app.pode_ver_obra(app.uuid_ou_nulo((storage.foldername(name))[2]))
  );

create policy fotos_escrita on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'obra-fotos'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and app.pode_editar_obra(app.uuid_ou_nulo((storage.foldername(name))[2]))
  );

create policy fotos_remocao on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'obra-fotos'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and app.eh_admin()
  );

-- Arquivo original da nota (XML, PDF ou foto): só equipe, nunca cliente.
create policy nfe_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'nfe-xml'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and app.eh_equipe()
    and app.pode_ver_obra(app.uuid_ou_nulo((storage.foldername(name))[2]))
  );

create policy nfe_escrita on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'nfe-xml'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and app.pode_editar_obra(app.uuid_ou_nulo((storage.foldername(name))[2]))
  );

-- PDF do relatório: equipe sempre; cliente apenas se o relatório estiver publicado.
create policy relatorios_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'relatorios'
    and app.uuid_ou_nulo((storage.foldername(name))[1]) = app.empresa_id()
    and (
      (app.eh_equipe() and app.pode_ver_obra(app.uuid_ou_nulo((storage.foldername(name))[2])))
      or exists (
        select 1 from public.relatorios_mensais r
         where r.pdf_path = storage.objects.name
           and r.publicado_em is not null
           and app.pode_ver_obra(r.obra_id)
      )
    )
  );
