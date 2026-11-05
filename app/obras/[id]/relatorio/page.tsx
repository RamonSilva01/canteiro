import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/sessao";
import { carregarObra } from "@/lib/obra";
import { hojeSP } from "@/lib/format";
import { Cabecalho } from "@/components/Cabecalho";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { gerarRelatorio, publicarRelatorio } from "./actions";

export const dynamic = "force-dynamic";

const nomeMes = (aaaaMm: string) => {
  const [a, m] = aaaaMm.split("-").map(Number);
  const texto = new Date(a, m - 1, 15).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export default async function RelatorioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") redirect(`/obras/${id}`);
  const obra = await carregarObra(supabase, id);

  const { data } = await supabase
    .from("relatorios_mensais")
    .select("id, competencia, pdf_path, gerado_em, publicado_em")
    .eq("obra_id", id)
    .order("competencia", { ascending: false });
  const relatorios = await Promise.all(
    (data ?? []).map(async (r) => {
      const { data: assinada } = r.pdf_path ? await supabase.storage.from("relatorios").createSignedUrl(r.pdf_path, 3600) : { data: null };
      return { ...r, mes: String(r.competencia).slice(0, 7), url: assinada?.signedUrl ?? null };
    }),
  );

  // Mês atual e os cinco anteriores
  const [anoAtual, mesAtual] = hojeSP().split("-").map(Number);
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(anoAtual, mesAtual - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const maisRecente = relatorios[0];

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-[1180px] mx-auto px-4 py-6 flex flex-col gap-5">
        <div className="page-head !mb-0">
          <div>
            <div className="text-[12.5px] text-[var(--muted)] mb-1">
              <Link href="/" className="underline">
                Obras
              </Link>{" "}
              /{" "}
              <Link href={`/obras/${id}`} className="underline">
                {obra.nome}
              </Link>
            </div>
            <h1 className="font-semibold">Relatório mensal</h1>
            <p className="sub">O mesmo relatório que o cliente já recebe, gerado com os números do sistema.</p>
          </div>
        </div>

        {sp.erro && <p className="bg-red-50 text-red-700 text-sm rounded-md px-4 py-2">{sp.erro}</p>}
        {sp.ok && <p className="bg-emerald-50 text-emerald-800 text-sm rounded-md px-4 py-2">{sp.ok}</p>}

        <form action={gerarRelatorio.bind(null, id)} className="kpi flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Mês do relatório
            <select name="competencia" defaultValue={meses[0]} className="border border-[var(--line-strong)] rounded-md px-3 py-2 bg-white">
              {meses.map((m) => (
                <option key={m} value={m}>
                  {nomeMes(m)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">
            Gerar relatório PDF
          </button>
          <p className="text-[13px] text-[var(--muted)] basis-full">
            Usa os números de agora e fica guardado como está. Ele só aparece para o cliente depois que você publicar.
          </p>
        </form>

        {relatorios.length === 0 ? (
          <p className="text-stone-600">Nenhum relatório gerado ainda.</p>
        ) : (
          <section className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500 border-b border-stone-200">
                <tr>
                  <th className="px-4 py-3 font-medium">Mês</th>
                  <th className="px-4 py-3 font-medium">Gerado em</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {relatorios.map((r) => (
                  <tr key={r.id} className="border-b border-stone-100">
                    <td className="px-4 py-3 font-medium">{nomeMes(r.mes)}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(r.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${r.publicado_em ? "pill-ok" : "pill-muted"}`}>
                        <i className="dot" />
                        {r.publicado_em ? "PUBLICADO" : "RASCUNHO"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <form className="flex justify-end items-center gap-3">
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="underline text-stone-700">
                            Abrir PDF
                          </a>
                        )}
                        {r.publicado_em ? (
                          <BotaoConfirmar
                            pergunta={`Retirar o relatório de ${nomeMes(r.mes)} do portal do cliente?`}
                            formAction={publicarRelatorio.bind(null, id, r.id, false)}
                            className="btn btn-ghost btn-sm"
                          >
                            Retirar do portal
                          </BotaoConfirmar>
                        ) : (
                          <BotaoConfirmar
                            pergunta={`Publicar o relatório de ${nomeMes(r.mes)}? O cliente poderá baixar no portal.`}
                            formAction={publicarRelatorio.bind(null, id, r.id, true)}
                            className="btn btn-primary btn-sm"
                          >
                            Publicar para o cliente
                          </BotaoConfirmar>
                        )}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {maisRecente?.url && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Prévia de {nomeMes(maisRecente.mes)}</h2>
            <iframe src={maisRecente.url} title="Prévia do relatório" className="w-full h-[820px] rounded-xl border border-[var(--line)] bg-white" />
          </section>
        )}
      </main>
    </>
  );
}
