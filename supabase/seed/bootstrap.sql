-- ============================================================
-- Bootstrap: cria a empresa e o primeiro administrador.
-- Rodar UMA vez no SQL Editor, depois de:
--   1. aplicar supabase/migrations/0001_init.sql
--   2. criar o usuário em Authentication > Users > Add user
--      (e-mail + senha, marcando "Auto Confirm User")
-- Troque os três valores marcados com <<< >>> antes de rodar.
-- ============================================================
do $$
declare
  v_email    text := '<<<email-do-admin>>>';
  v_nome     text := '<<<Nome do admin>>>';
  v_empresa  text := '<<<Nome da empresa>>>';
  v_user_id  uuid;
  v_empresa_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(v_email);
  if v_user_id is null then
    raise exception 'Usuário % não existe em auth.users. Crie em Authentication > Users primeiro.', v_email;
  end if;

  insert into public.empresas (nome, slug)
  values (
    v_empresa,
    trim(both '-' from regexp_replace(lower(extensions.unaccent(v_empresa)), '[^a-z0-9]+', '-', 'g'))
  )
  returning id into v_empresa_id;

  insert into public.perfis (id, empresa_id, papel, nome, email)
  values (v_user_id, v_empresa_id, 'admin', v_nome, v_email);

  raise notice 'Empresa % criada, % é admin.', v_empresa_id, v_email;
end;
$$;
