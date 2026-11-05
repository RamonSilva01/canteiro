import Link from "next/link";
import { redirect } from "next/navigation";
import { sessao } from "@/lib/sessao";
import { contarPendentes } from "@/lib/obra";
import { dataBR, pct, reaisInteiro } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { Kpi } from "@/components/Kpi";
import { feedAtivo } from "@/lib/recursos";
import { sair } from "./login/actions";

export const dynamic = "force-dynamic";

type ObraConsolidada = {
  id: string;
  nome: string;
  data_inicio: string | null;
  data_entrega_prevista: string | null;
  orcamento_total: number;
  custo_real_total: number;
  custo_projetado_total: number;
  economia_total: number;
  avanco_geral: number;
  avanco_esperado: number | null;
  situacao_prazo: string;
};

const ORDEM_SITUACAO: Record<string, number> = { atrasada: 0, no_prazo: 1, adiantada: 2, sem_prazo: 3 };
const SITUACAO: Record<string, [string, string, string]> = {
  adiantada: ["ADIANTADA", "pill-ok", "ok"],
  no_prazo: ["NO PRAZO", "pill-warn", "warn"],
  atrasada: ["ATRASADA", "pill-bad", "bad"],
  sem_prazo: ["SEM PRAZO", "pill-muted", ""],
};

export default async function Home() {
  const { supabase, user, perfil } = await sessao();

  if (!perfil) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm p-8 flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Canteiro</h1>
          <p className="text-stone-700">
            Login ok ({user.email}), mas este usuário ainda não tem perfil em nenhuma empresa. Rode o{" "}
            <code>supabase/seed/bootstrap.sql</code>.
          </p>
          <form action={sair}>
            <button type="submit" className="text-sm text-stone-500 underline">
              Sair
            </button>
          </form>
        </div>
      </main>
    );
  }

  const { data } = await supabase.from("vw_obras_consolidadas").select("*");
  // Atrasadas primeiro: a pergunta da manhã é "alguma obra precisa de mim hoje?".
  const obras = ((data ?? []) as ObraConsolidada[]).sort(
    (a, b) =>
      ORDEM_SITUACAO[a.situacao_prazo] - ORDEM_SITUACAO[b.situacao_prazo] ||
      (a.data_entrega_prevista ?? "9").localeCompare(b.data_entrega_prevista ?? "9"),
  );

  // Cliente com uma obra só vai direto para ela.
  if (perfil.papel === "cliente" && obras.length === 1) redirect(`/obras/${obras[0].id}`);

  const equipe = perfil.papel !== "cliente";
  const umaSemanaAtras = new Date(Date.now() - 7 * 864e5).toISOString();
  const [pendentes, fotos] = await Promise.all([
    Promise.all(obras.map((o) => (equipe ? contarPendentes(supabase, o.id) : 0))),
    Promise.all(
      obras.map(async (o) => {
        if (!feedAtivo()) return 0;
        const { count } = await supabase
          .from("post_midias")
          .select("id", { count: "exact", head: true })
          .eq("obra_id", o.id)
          .gte("criada_em", umaSemanaAtras);
        return count ?? 0;
      }),
    ),
  ]);
  const soma = (k: keyof ObraConsolidada) => obras.reduce((t, o) => t + Number(o[k] ?? 0), 0);
  const economia = soma("economia_total");
  const totalPendentes = pendentes.reduce((t, n) => t + n, 0);

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-[1180px] mx-auto px-4 py-6">
        <div className="page-head">
          <div>
            <h1 className="font-semibold">Minhas obras</h1>
            <p className="sub">
              {obras.length} {obras.length === 1 ? "obra ativa" : "obras ativas"}
            </p>
          </div>
          <span className="spacer" />
          {perfil.papel === "admin" && (
            <Link href="/obras/nova" className="btn btn-ghost btn-sm">
              Nova obra
            </Link>
          )}
          {equipe && obras.length === 1 && (
            <Link href={`/obras/${obras[0].id}/lancamentos`} className="btn btn-primary">
              Lançar despesa
            </Link>
          )}
        </div>

        {equipe && obras.length > 0 && (
          <section className="grade g-kpi mb-[18px]">
            <Kpi rotulo="Obras ativas" valor={String(obras.length)} detalhe={`${reaisInteiro(soma("custo_real_total"))} gastos até hoje`} />
            <Kpi rotulo="Volume sob gestão" valor={reaisInteiro(soma("orcamento_total"))} detalhe="orçamento somado" />
            <Kpi
              rotulo="Economia gerada"
              valor={reaisInteiro(economia)}
              detalhe="no acumulado das obras"
              tom={economia < 0 ? "bad" : economia > 0 ? "ok" : undefined}
            />
            <Kpi
              rotulo="Pendências"
              valor={String(totalPendentes)}
              detalhe={totalPendentes === 1 ? "lançamento a conferir" : "lançamentos a conferir"}
              tom={totalPendentes > 0 ? "bad" : undefined}
            />
          </section>
        )}

        {obras.length === 0 ? (
          <p className="text-stone-600">Nenhuma obra ainda.</p>
        ) : (
          <section className="grade g-obras">
            {obras.map((o, i) => {
              const [rotulo, pill, barra] = SITUACAO[o.situacao_prazo] ?? SITUACAO.sem_prazo;
              const economiaObra = Number(o.economia_total);
              return (
                <Link key={o.id} href={`/obras/${o.id}`} className="obra-card">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <h3>{o.nome}</h3>
                      <div className="end">Entrega prevista: {dataBR(o.data_entrega_prevista)}</div>
                    </div>
                    <span className={`pill ${pill}`}>
                      <i className="dot" />
                      {rotulo}
                    </span>
                  </div>
                  <div className="row">
                    <span className="pct num">{pct(o.avanco_geral)}</span>
                    <span className="vs">
                      {o.avanco_esperado == null ? "real · sem datas previstas" : `real · projetado para hoje ${pct(o.avanco_esperado)}`}
                    </span>
                  </div>
                  <div className={`bar ${barra} mt-2`}>
                    <i style={{ width: `${Math.min(Number(o.avanco_geral), 100)}%` }} />
                    {o.avanco_esperado != null && <span className="ghost" style={{ left: `${Math.min(Number(o.avanco_esperado), 100)}%` }} />}
                  </div>
                  <dl>
                    <div>
                      <dt>Projetado</dt>
                      <dd className="num">{reaisInteiro(o.custo_projetado_total)}</dd>
                    </div>
                    <div>
                      <dt>Gasto</dt>
                      <dd className="num">{reaisInteiro(o.custo_real_total)}</dd>
                    </div>
                  </dl>
                  <div className="foot">
                    <span>
                      Econômetro{" "}
                      <b className={`num ${economiaObra < 0 ? "text-[var(--bad)]" : economiaObra > 0 ? "text-[var(--ok)]" : ""}`}>
                        {reaisInteiro(economiaObra)}
                      </b>
                    </span>
                    {pendentes[i] > 0 ? (
                      <span className="pill pill-bad !py-0.5 !px-2">
                        {pendentes[i]} {pendentes[i] === 1 ? "lançamento pendente" : "lançamentos pendentes"}
                      </span>
                    ) : (
                      fotos[i] > 0 && <span>{fotos[i]} {fotos[i] === 1 ? "foto esta semana" : "fotos esta semana"}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </section>
        )}
      </main>
    </>
  );
}
