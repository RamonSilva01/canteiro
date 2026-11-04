import Link from "next/link";
import { redirect } from "next/navigation";
import { sessao } from "@/lib/sessao";
import { dataBR, pct, reais } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { Kpi } from "@/components/Kpi";
import { BarraDupla, Economia, Situacao } from "@/components/Situacao";
import { sair } from "./login/actions";

export const dynamic = "force-dynamic";

type ObraConsolidada = {
  id: string;
  nome: string;
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

  const [{ data }, { data: extras }] = await Promise.all([
    supabase.from("vw_obras_consolidadas").select("*"),
    supabase.from("obras").select("id, cliente_nome").is("arquivada_em", null),
  ]);
  // Atrasadas primeiro: a pergunta da manhã é "alguma obra precisa de mim hoje?".
  const obras = ((data ?? []) as ObraConsolidada[]).sort(
    (a, b) =>
      ORDEM_SITUACAO[a.situacao_prazo] - ORDEM_SITUACAO[b.situacao_prazo] ||
      (a.data_entrega_prevista ?? "9").localeCompare(b.data_entrega_prevista ?? "9"),
  );
  const cliente = new Map((extras ?? []).map((o) => [o.id as string, o.cliente_nome as string | null]));

  // Cliente com uma obra só vai direto para ela.
  if (perfil.papel === "cliente" && obras.length === 1) redirect(`/obras/${obras[0].id}`);

  const soma = (k: keyof ObraConsolidada) => obras.reduce((t, o) => t + Number(o[k] ?? 0), 0);

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Obras</h1>
          {perfil.papel === "admin" && (
            <Link href="/obras/nova" className="bg-stone-900 text-white text-sm rounded-md px-4 py-2 hover:bg-stone-700">
              Nova obra
            </Link>
          )}
        </div>

        {perfil.papel !== "cliente" && obras.length > 0 && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi rotulo="Obras ativas" valor={String(obras.length)} />
            <Kpi rotulo="Volume sob gestão" valor={reais(soma("orcamento_total"))} />
            <Kpi rotulo="Gasto até hoje" valor={reais(soma("custo_real_total"))} />
            <Kpi rotulo="Economia gerada" valor={<Economia valor={soma("economia_total")} />} />
          </section>
        )}

        {obras.length === 0 ? (
          <p className="text-stone-600">Nenhuma obra ainda.</p>
        ) : (
          <section className="grid md:grid-cols-2 gap-4">
            {obras.map((o) => (
              <Link
                key={o.id}
                href={`/obras/${o.id}`}
                className="bg-white rounded-xl shadow-sm p-5 flex flex-col gap-3 hover:ring-2 hover:ring-stone-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{o.nome}</h2>
                    <p className="text-sm text-stone-500">{cliente.get(o.id) ?? "Cliente não informado"}</p>
                  </div>
                  <Situacao valor={o.situacao_prazo} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span>Avanço {pct(o.avanco_geral)}</span>
                    <span className="text-stone-500">esperado {pct(o.avanco_esperado)}</span>
                  </div>
                  <BarraDupla
                    real={Number(o.avanco_geral)}
                    esperado={o.avanco_esperado == null ? null : Number(o.avanco_esperado)}
                  />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-stone-500">Projetado</dt>
                    <dd className="num">{reais(o.custo_projetado_total)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Gasto</dt>
                    <dd className="num">{reais(o.custo_real_total)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Economia</dt>
                    <dd>
                      <Economia valor={Number(o.economia_total)} />
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-stone-500">Entrega prevista: {dataBR(o.data_entrega_prevista)}</p>
              </Link>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
