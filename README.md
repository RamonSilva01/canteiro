# Canteiro

Acompanhamento de obra para administradoras de obra e seus clientes. Substitui o
Excel de controle e o PDF mensal: o admin lança as notas e o avanço, o cliente
acompanha a própria obra ao vivo.

Escopo, PRD, arquitetura e wireframes ficam na pasta do projeto, um nível acima
(`../ESCOPO.md` e `../docs/`).

## Stack

Next.js 15 (App Router) · Supabase (Postgres + Auth + Storage, RLS em tudo) · Vercel.

## Rodar local

```bash
npm install
cp .env.example .env.local   # e preencher com as chaves do Supabase
npm run dev
```

## Banco

O arquivo é a verdade, o painel é só para inspeção.

1. **Schema:** colar no SQL Editor do Supabase e rodar, em ordem, cada arquivo de
   `supabase/migrations/` (`0001_init.sql`, `0002_importacao_notas.sql`,
   `0003_obras_select_insert.sql`, `0004_veto_nota_repetida.sql`). Migration nova entra no fim e no `test:db`.
2. **Cadastro fechado:** em Authentication > Sign In / Providers, desligar
   "Allow new users to sign up". Cliente entra só por convite.
3. **Primeiro admin:** criar o usuário em Authentication > Users > Add user
   (com "Auto Confirm User"), editar os 3 valores de `supabase/seed/bootstrap.sql`
   e rodar no SQL Editor.

## Regras de negócio que vivem no banco

| Regra | Onde |
|---|---|
| Cliente só vê as obras às quais está vinculado | RLS + `app.pode_ver_obra` |
| Cliente vê todo lançamento confirmado (transparência total) | policy `lancamentos_select` |
| Projetado = orçamento × % avanço; economia = projetado − real (negativa aparece) | `vw_etapas_consolidadas` |
| "Esperado para hoje" vem das datas previstas de cada etapa | `vw_etapas_consolidadas.avanco_esperado` |
| Status da obra = avanço real × esperado das etapas com prazo (tolerância de 5 p.p.) | `vw_obras_consolidadas.situacao_prazo` |
| Frete, desconto, IPI etc. da nota são lançamentos próprios, sem rateio | `lancamentos.componente` + `vw_notas_conferencia` |
