import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFileSync } from "node:fs";

// Roda a migration e o bootstrap num Postgres em memória (PGlite), com stubs
// do que o Supabase já traz (auth, storage, papéis), e confere RLS e cálculos.
// Uso: npm run test:db
const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../seed/bootstrap.sql", import.meta.url), "utf8");
const db = new PGlite({ extensions: { pg_trgm, unaccent } });

// --- Stubs do que o Supabase já traz pronto ---
await db.exec(`
  create schema extensions;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
`);

await db.exec(migration);
console.log("OK migration aplicada");

const U = {
  adminA: "00000000-0000-0000-0000-00000000000a",
  cliA:   "00000000-0000-0000-0000-0000000000c1",
  colabA: "00000000-0000-0000-0000-0000000000c2",
  colab2: "00000000-0000-0000-0000-0000000000c3",
  adminB: "00000000-0000-0000-0000-00000000000b",
};
await db.exec(`insert into auth.users values
  ('${U.adminA}','kristian@exemplo.com'), ('${U.cliA}','alexandre@exemplo.com'),
  ('${U.colabA}','mestre@exemplo.com'), ('${U.colab2}','outro@exemplo.com'),
  ('${U.adminB}','b@exemplo.com');`);

// bootstrap real (empresa A + admin), valores substituídos
await db.exec(bootstrap
  .replace("<<<email-do-admin>>>", "kristian@exemplo.com")
  .replace("<<<Nome do admin>>>", "Kristian")
  .replace("<<<Nome da empresa>>>", "Administração de Obras Kristian"));
const { rows: [emp] } = await db.query(`select id, slug from public.empresas`);
console.log("OK bootstrap, slug =", emp.slug);
const A = emp.id;

// resto do cenário como superusuário (equivale a service_role)
const { rows: [b] } = await db.query(`insert into empresas (nome, slug) values ('Outra','outra') returning id`);
const B = b.id;
await db.exec(`
  insert into perfis (id, empresa_id, papel, nome, email) values
    ('${U.cliA}','${A}','cliente','Alexandre','alexandre@exemplo.com'),
    ('${U.colabA}','${A}','colaborador','Mestre','mestre@exemplo.com'),
    ('${U.colab2}','${A}','colaborador','Outro','outro@exemplo.com'),
    ('${U.adminB}','${B}','admin','B','b@exemplo.com');
  insert into obras (id, empresa_id, nome, data_inicio) values
    ('10000000-0000-0000-0000-000000000001','${A}','Portobello', app.hoje() - 30),
    ('10000000-0000-0000-0000-000000000002','${A}','Outra obra A', null),
    ('10000000-0000-0000-0000-000000000003','${B}','Obra B', null);
  insert into obra_membros (obra_id, usuario_id) values
    ('10000000-0000-0000-0000-000000000001','${U.cliA}'),
    ('10000000-0000-0000-0000-000000000001','${U.colabA}');
  insert into templates_obra (id, empresa_id, nome, eh_padrao) values
    ('20000000-0000-0000-0000-000000000001','${A}','Residencial',true);
  insert into template_itens (id, template_id, empresa_id, nome, ordem, orcamento_sugerido, duracao_dias) values
    ('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','${A}','Fundação',1,100000,60),
    ('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','${A}','Alvenaria',2,50000,60);
  insert into template_itens (template_id, empresa_id, item_pai_id, nome, ordem) values
    ('20000000-0000-0000-0000-000000000001','${A}','21000000-0000-0000-0000-000000000001','Aço',1);
`);

async function como(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
let falhas = 0;
function check(nome, ok, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${nome} ${extra}`); if (!ok) falhas++; }
async function deveFalhar(nome, fn) {
  try { await fn(); check(nome, false, "(não deu erro)"); } catch (e) { check(nome, true, `(${e.message.slice(0, 70)})`); }
}

// admin aplica template na obra (com datas sequenciais a partir de data_inicio)
const n = await como(U.adminA, () => db.query(
  `select aplicar_template_na_obra('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001') as n`));
check("template criou 2 etapas", n.rows[0].n === 2);
const { rows: etapas } = await db.query(`select id, nome, data_inicio_prevista, data_fim_prevista from etapas order by ordem`);
console.log("     etapas:", etapas.map(e => `${e.nome} ${e.data_inicio_prevista?.toISOString?.().slice(0,10)}..${e.data_fim_prevista?.toISOString?.().slice(0,10)}`).join(" | "));
const fund = etapas[0].id;

// avanço + nota com frete e desconto (D2)
await como(U.colabA, () => db.query(
  `insert into avancos_etapa (obra_id, etapa_id, percentual, registrado_por) values ($1,$2,60,$3)`,
  ["10000000-0000-0000-0000-000000000001", fund, U.colabA]));
await como(U.adminA, async () => {
  const { rows: [nf] } = await db.query(`insert into notas_fiscais (obra_id, numero, valor_produtos, valor_frete, valor_desconto, valor_total)
    values ('10000000-0000-0000-0000-000000000001','1234', 70000, 240, 40, 70200) returning id`);
  await db.query(`insert into lancamentos (obra_id, etapa_id, nota_fiscal_id, componente, data_competencia, descricao, valor_total, origem, status, item_numero) values
    ('10000000-0000-0000-0000-000000000001',$1,$2,'item', app.hoje(),'Aço CA-50',70000,'xml_nfe','confirmado',1),
    ('10000000-0000-0000-0000-000000000001',$1,$2,'frete', app.hoje(),'Frete da NF 1234',240,'xml_nfe','confirmado',null),
    ('10000000-0000-0000-0000-000000000001',$1,$2,'desconto', app.hoje(),'Desconto da NF 1234',-40,'xml_nfe','confirmado',null),
    ('10000000-0000-0000-0000-000000000001',null,null,'item', app.hoje(),'Cimento (pendente)',500,'manual','pendente',null)`,
    [fund, nf.id]);
});
const conf = await como(U.adminA, () => db.query(`select diferenca from vw_notas_conferencia`));
check("D2 nota fecha: soma dos lançamentos = vNF", Number(conf.rows[0].diferenca) === 0);
await deveFalhar("D2 desconto positivo é recusado", () => como(U.adminA, () => db.query(
  `insert into lancamentos (obra_id, componente, data_competencia, descricao, valor_total, origem) values
   ('10000000-0000-0000-0000-000000000001','desconto', app.hoje(),'x',10,'manual')`)));

// D1 + D4: views
const ve = await como(U.cliA, () => db.query(`select nome, percentual_avanco, avanco_esperado, situacao_prazo, custo_projetado, custo_real, economia from vw_etapas_consolidadas order by ordem`));
console.log("     etapas (visão do cliente):", JSON.stringify(ve.rows));
check("D1 esperado da Fundação = 50% (dia 30 de 60)", Number(ve.rows[0].avanco_esperado) === 50);
check("D1 Fundação 60% vs 50% = adiantada", ve.rows[0].situacao_prazo === "adiantada");
check("D4 economia negativa aparece (60.000 − 70.200)", Number(ve.rows[0].economia) === -10200);
const vo = await como(U.cliA, () => db.query(`select avanco_geral, avanco_esperado, avanco_real_planejado, situacao_prazo, economia_total from vw_obras_consolidadas`));
console.log("     obra (visão do cliente):", JSON.stringify(vo.rows));
check("D1 obra: esperado ponderado = 33.33", Number(vo.rows[0].avanco_esperado) === 33.33);

// RLS
const t1 = await como(U.cliA, () => db.query(`select nome from obras`));
check("T1/T2 cliente vê só a própria obra", t1.rows.length === 1 && t1.rows[0].nome === "Portobello");
const t2 = await como(U.adminB, () => db.query(`select count(*)::int as n from lancamentos`));
check("T1 admin da empresa B não vê nada da A", t2.rows[0].n === 0);
await deveFalhar("T3 cliente não insere lançamento", () => como(U.cliA, () => db.query(
  `insert into lancamentos (obra_id, data_competencia, descricao, valor_total, origem) values
   ('10000000-0000-0000-0000-000000000001', app.hoje(),'x',1,'manual')`)));
const t4 = await como(U.cliA, () => db.query(`select descricao from lancamentos`));
check("T4/D3 cliente vê os 3 confirmados (frete e desconto inclusos), não o pendente", t4.rows.length === 3);
await deveFalhar("T6 colaborador não vinculado não registra avanço", () => como(U.colab2, () => db.query(
  `insert into avancos_etapa (obra_id, etapa_id, percentual, registrado_por) values ($1,$2,70,$3)`,
  ["10000000-0000-0000-0000-000000000001", fund, U.colab2])));
const t7 = await como(U.colabA, () => db.query(`update etapas set orcamento_referencia = 1 where id = $1`, [fund]));
check("T7 colaborador não altera orçamento", t7.affectedRows === 0);
await deveFalhar("T8 cliente não se promove a admin", () => como(U.cliA, () => db.query(
  `update perfis set papel = 'admin' where id = '${U.cliA}'`)));
await deveFalhar("T9 vincular usuário a obra de outra empresa", () => db.query(
  `insert into obra_membros (obra_id, empresa_id, usuario_id) values ('10000000-0000-0000-0000-000000000003','${B}','${U.cliA}')`)
  .then(() => db.query(`select 1 from obra_membros m join perfis p on p.id = m.usuario_id where m.empresa_id <> p.empresa_id`))
  .then(r => { if (r.rows.length) throw new Error("vínculo cruzado existe (FK não cobre usuário)"); }));
const anon = await db.exec(`set role anon;`).then(() => db.query(`select count(*) from obras`)).then(() => "leu", () => "negado").finally(() => db.exec("reset role"));
check("anon não lê nada", anon === "negado");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
