-- ============================================================
-- Canteiro · 0005 · colaborador cria obra e monta as etapas
-- Pedido do Kristian (10/11/2026): quem cadastra e monta a obra no dia a dia
-- é o colaborador, não o dono. Regras:
--   1. Colaborador pode criar obra (sempre em nome dele: criada_por = ele).
--   2. Quem criou fica vinculado à obra na hora (senão não a enxergaria).
--   3. Colaborador vinculado edita etapas (nome, orçamento, datas, ordem).
-- Editar os dados da obra, arquivar, excluir obra e gerir pessoas seguem só
-- com o administrador.
-- ============================================================

drop policy if exists obras_insert on public.obras;

create policy obras_insert on public.obras
  for insert to authenticated
  with check (
    empresa_id = app.empresa_id()
    and (
      app.eh_admin()
      or (app.papel() = 'colaborador'::public.papel_usuario and criada_por = auth.uid())
    )
  );

-- Vincula o colaborador à obra que ele acabou de criar.
create or replace function app.vincular_criador_da_obra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.criada_por is not null
     and exists (
       select 1 from public.perfis p
        where p.id = new.criada_por
          and p.empresa_id = new.empresa_id
          and p.papel = 'colaborador'::public.papel_usuario
     )
  then
    insert into public.obra_membros (obra_id, empresa_id, usuario_id, vinculado_por)
    values (new.id, new.empresa_id, new.criada_por, new.criada_por)
    on conflict (obra_id, usuario_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists obras_vincula_criador on public.obras;
create trigger obras_vincula_criador
  after insert on public.obras
  for each row execute function app.vincular_criador_da_obra();

-- Etapas: admin, ou colaborador vinculado à obra.
drop policy if exists etapas_write_admin on public.etapas;
drop policy if exists etapas_write on public.etapas;

create policy etapas_write on public.etapas
  for all to authenticated
  using (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id))
  with check (empresa_id = app.empresa_id() and app.pode_editar_obra(obra_id));

-- Excluir pessoa (tela Pessoas, só admin): o login some e as colunas de autoria
-- viram null (on delete set null). A regra de ouro exigia confirmado_por, o que
-- impedia excluir quem já confirmou lançamento. O trigger lancamentos_confirmacao
-- continua preenchendo confirmado_por na confirmação; a regra passa a exigir só
-- etapa e data de confirmação.
alter table public.lancamentos drop constraint if exists lancamentos_confirmado_ck;
alter table public.lancamentos add constraint lancamentos_confirmado_ck check (
  status = 'pendente'
  or (etapa_id is not null and confirmado_em is not null)
);
