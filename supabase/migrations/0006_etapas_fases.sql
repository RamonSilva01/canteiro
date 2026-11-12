-- ============================================================
-- 0006 · Etapa em fases e etapa que dura a obra toda
-- Pedido do Kristian (áudio de 12/11/2026): hidráulica e elétrica acontecem
-- no início, no meio e no fim da obra; mão de obra e locação, a obra inteira.
--
-- A etapa continua UMA só (um orçamento, um % de avanço, lançamentos juntos).
-- O que muda é o período previsto:
--   · fases (jsonb): lista [{inicio, fim}, ...] quando a etapa tem 2+ períodos.
--     Com fases, data_inicio_prevista/data_fim_prevista viram o envelope
--     (1º início e último fim), preenchidos aqui pelo trigger.
--     Sem fases (null), vale a janela única de sempre.
--   · obra_toda: o período é o da obra (data_inicio até data_entrega_prevista)
--     e acompanha sozinho quando as datas da obra mudam.
-- O "esperado para hoje" conta só os dias dentro dos períodos: nos meses
-- parados entre uma fase e outra ele não sobe, e a etapa não fica "atrasada".
-- ============================================================

alter table public.etapas
  add column if not exists fases     jsonb,
  add column if not exists obra_toda boolean not null default false;

-- Valida as fases e preenche o envelope. Mensagens com a chave etapas_fases_ck
-- para o lib/erros.ts traduzir.
create or replace function app.etapas_normalizar_fases()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_qtd int;
  v_ruins int;
  v_sobrepostas int;
begin
  if new.fases is null or new.fases = 'null'::jsonb
     or (jsonb_typeof(new.fases) = 'array' and jsonb_array_length(new.fases) = 0) then
    new.fases := null;
    return new;
  end if;

  if jsonb_typeof(new.fases) <> 'array' then
    raise exception 'etapas_fases_ck: fases deve ser uma lista';
  end if;

  select count(*),
         count(*) filter (where f->>'inicio' is null or f->>'fim' is null
                             or (f->>'fim')::date < (f->>'inicio')::date)
    into v_qtd, v_ruins
    from jsonb_array_elements(new.fases) f;

  if v_ruins > 0 then
    raise exception 'etapas_fases_ck: cada fase precisa de início e fim, com fim depois do início';
  end if;

  -- ordena por início e confere que uma fase não invade a outra
  new.fases := (
    select jsonb_agg(jsonb_build_object('inicio', (f->>'inicio')::date, 'fim', (f->>'fim')::date)
                     order by (f->>'inicio')::date)
      from jsonb_array_elements(new.fases) f
  );

  select count(*) into v_sobrepostas
    from (
      select (f->>'inicio')::date as ini,
             lag((f->>'fim')::date) over (order by (f->>'inicio')::date) as fim_anterior
        from jsonb_array_elements(new.fases) f
    ) x
   where x.ini <= x.fim_anterior;

  if v_sobrepostas > 0 then
    raise exception 'etapas_fases_ck: as fases não podem se sobrepor';
  end if;

  if v_qtd = 1 then
    -- uma fase só é a janela comum
    new.data_inicio_prevista := (new.fases->0->>'inicio')::date;
    new.data_fim_prevista    := (new.fases->0->>'fim')::date;
    new.fases := null;
  else
    new.data_inicio_prevista := (new.fases->0->>'inicio')::date;
    new.data_fim_prevista    := (new.fases->(v_qtd - 1)->>'fim')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists etapas_fases on public.etapas;
create trigger etapas_fases
  before insert or update of fases, data_inicio_prevista, data_fim_prevista on public.etapas
  for each row execute function app.etapas_normalizar_fases();

-- ------------------------------------------------------------
-- Views: mesmas colunas de antes + fases e obra_toda no fim.
-- data_inicio_prevista/data_fim_prevista passam a ser as EFETIVAS
-- (as da obra quando obra_toda).
-- ------------------------------------------------------------
drop view if exists public.vw_obras_consolidadas;
drop view if exists public.vw_etapas_consolidadas;

create view public.vw_etapas_consolidadas
with (security_invoker = true) as
with periodos as (
  -- todos os períodos previstos de cada etapa, já resolvidos
  select e.id as etapa_id, p.ini, p.fim
    from public.etapas e
    join public.obras o on o.id = e.obra_id
    cross join lateral (
      select o.data_inicio as ini, o.data_entrega_prevista as fim where e.obra_toda
      union all
      select (f->>'inicio')::date, (f->>'fim')::date
        from jsonb_array_elements(e.fases) f
       where not e.obra_toda and e.fases is not null
      union all
      select e.data_inicio_prevista, e.data_fim_prevista
       where not e.obra_toda and e.fases is null
    ) p
   where p.ini is not null and p.fim is not null and p.fim >= p.ini
),
esperado as (
  -- dias inteiros já passados dentro dos períodos / total de dias dos períodos
  -- (com um período só, é exatamente a conta de antes)
  select etapa_id,
         round(100.0 * sum(greatest(0, least(app.hoje(), fim + 1) - ini))
                     / sum(fim - ini + 1), 2) as avanco_esperado
    from periodos
   group by etapa_id
),
base as (
  select
    e.id                                     as etapa_id,
    e.obra_id,
    e.empresa_id,
    e.nome,
    e.ordem,
    e.orcamento_referencia,
    e.percentual_avanco,
    case when e.obra_toda then o.data_inicio           else e.data_inicio_prevista end as data_inicio_prevista,
    case when e.obra_toda then o.data_entrega_prevista else e.data_fim_prevista    end as data_fim_prevista,
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
    x.avanco_esperado,
    e.fases,
    e.obra_toda
  from public.etapas e
  join public.obras o on o.id = e.obra_id
  left join esperado x on x.etapa_id = e.id
  left join lateral (
    select sum(l.valor_total) as custo_real, count(*) as qtd_lancamentos
      from public.lancamentos l
     where l.etapa_id = e.id
       and l.status = 'confirmado'
       and l.excluido_em is null
  ) r on true
)
select
  b.etapa_id, b.obra_id, b.empresa_id, b.nome, b.ordem, b.orcamento_referencia,
  b.percentual_avanco, b.data_inicio_prevista, b.data_fim_prevista,
  b.data_inicio_real, b.data_fim_real, b.custo_real, b.custo_projetado,
  b.economia, b.qtd_lancamentos, b.avanco_esperado,
  case
    when b.avanco_esperado is null                        then 'sem_prazo'
    when b.percentual_avanco - b.avanco_esperado >= 5     then 'adiantada'
    when b.percentual_avanco - b.avanco_esperado <= -5    then 'atrasada'
    else 'no_prazo'
  end as situacao_prazo,
  b.fases,
  b.obra_toda
from base b;

-- Por obra: idêntica à da 0001 (recriada porque depende da view acima).
create view public.vw_obras_consolidadas
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

-- views recriadas perdem os grants
grant select on public.vw_etapas_consolidadas, public.vw_obras_consolidadas to authenticated, service_role;
grant execute on function app.etapas_normalizar_fases() to authenticated, service_role;
