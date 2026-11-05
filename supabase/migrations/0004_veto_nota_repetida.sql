-- Veta nota repetida mesmo sem chave de acesso (cupom, recibo, foto).
-- Mesmo fornecedor (CNPJ; sem CNPJ em alguma das duas, o nome) e:
--   mesmo número da nota, ou
--   mesmo valor total na mesma data (ou com a data faltando em alguma das duas).
-- Nota com todos os lançamentos descartados não conta: pode ser importada de novo.
create or replace function app.vetar_nota_repetida()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_numero    text := nullif(ltrim(regexp_replace(coalesce(new.numero, ''), '\D', '', 'g'), '0'), '');
  v_nome      text := nullif(regexp_replace(unaccent(lower(coalesce(new.emit_nome, ''))), '[^a-z0-9]', '', 'g'), '');
  v_data      date := (new.data_emissao at time zone 'America/Sao_Paulo')::date;
  v_existente uuid;
begin
  select n.id into v_existente
    from public.notas_fiscais n
   where n.empresa_id = new.empresa_id
     and case
           when n.emit_cnpj is not null and new.emit_cnpj is not null then n.emit_cnpj = new.emit_cnpj
           else v_nome is not null
            and regexp_replace(unaccent(lower(coalesce(n.emit_nome, ''))), '[^a-z0-9]', '', 'g') = v_nome
         end
     and (
       (v_numero is not null
         and ltrim(regexp_replace(coalesce(n.numero, ''), '\D', '', 'g'), '0') = v_numero)
       or (new.valor_total is not null
         and n.valor_total = new.valor_total
         and (v_data is null or n.data_emissao is null
              or (n.data_emissao at time zone 'America/Sao_Paulo')::date = v_data))
     )
     and exists (select 1 from public.lancamentos l where l.nota_fiscal_id = n.id and l.excluido_em is null)
   order by n.importada_em
   limit 1;

  if v_existente is not null then
    raise exception 'NOTA_DUPLICADA:%', v_existente;
  end if;
  return new;
end;
$$;

-- O nome faz este gatilho rodar depois de notas_empresa, que preenche empresa_id.
create trigger notas_vetar_repetida
  before insert on public.notas_fiscais
  for each row execute function app.vetar_nota_repetida();
