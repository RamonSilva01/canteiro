-- ============================================================
-- Canteiro · 0003 · leitura da obra recém-criada
-- obras_select usava app.pode_ver_obra(id), que procura a obra na própria
-- tabela: no INSERT ... RETURNING a linha nova ainda não está no snapshot da
-- função, e o admin não conseguia criar obra ("violates row-level security").
-- A regra passa a olhar a linha direto, com o mesmo efeito.
-- ============================================================

drop policy if exists obras_select on public.obras;

create policy obras_select on public.obras
  for select to authenticated
  using (
    empresa_id = app.empresa_id()
    and (
      app.eh_admin()
      or exists (
        select 1 from public.obra_membros m
         where m.obra_id = obras.id and m.usuario_id = auth.uid()
      )
    )
  );
