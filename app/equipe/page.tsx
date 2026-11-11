import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/sessao";
import { Cabecalho } from "@/components/Cabecalho";
import { BotaoNovoLink, FormConvite } from "./Convite";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { excluirPessoa, salvarAcesso } from "./actions";

export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = { admin: "Administrador", colaborador: "Colaborador", cliente: "Cliente" };

export default async function EquipePage() {
  const { supabase, perfil } = await exigirPerfil();
  if (perfil.papel !== "admin") redirect("/");

  const [{ data: pessoas }, { data: obras }, { data: vinculos }] = await Promise.all([
    supabase.from("perfis").select("id, nome, email, papel, ativo").order("papel").order("nome"),
    supabase.from("obras").select("id, nome").is("arquivada_em", null).order("nome"),
    supabase.from("obra_membros").select("obra_id, usuario_id"),
  ]);
  const obrasDe = (id: string) => new Set((vinculos ?? []).filter((v) => v.usuario_id === id).map((v) => v.obra_id));

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Pessoas</h1>

        <section className="bg-white rounded-xl shadow-sm p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Convidar</h2>
          <FormConvite obras={(obras ?? []) as { id: string; nome: string }[]} />
        </section>

        <section className="flex flex-col gap-3">
          {(pessoas ?? []).map((p) => {
            const minhas = obrasDe(p.id);
            const euMesmo = p.id === perfil.id;
            return (
              <div key={p.id} className={`bg-white rounded-xl shadow-sm p-5 flex flex-col gap-3 ${p.ativo ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {p.nome} {euMesmo && <span className="text-stone-500 font-normal">(você)</span>}
                    </p>
                    <p className="text-sm text-stone-500">
                      {p.email} · {PAPEL[p.papel]}
                      {!p.ativo && " · acesso desligado"}
                    </p>
                  </div>
                </div>
                {!euMesmo && (
                  <>
                    <form action={salvarAcesso.bind(null, p.id)} className="flex flex-col gap-2 text-sm">
                      {p.papel !== "admin" && (
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          {(obras ?? []).map((o) => (
                            <label key={o.id} className="flex items-center gap-1">
                              <input type="checkbox" name="obra" value={o.id} defaultChecked={minhas.has(o.id)} /> {o.nome}
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" name="ativo" defaultChecked={p.ativo} /> Acesso ligado
                        </label>
                        <button type="submit" className="border border-stone-300 rounded-md px-3 py-1">
                          Salvar
                        </button>
                      </div>
                    </form>
                    <div className="flex flex-wrap items-center gap-4">
                      <BotaoNovoLink usuarioId={p.id} />
                      <form action={excluirPessoa.bind(null, p.id)}>
                        <BotaoConfirmar
                          pergunta={`Excluir ${p.nome} do Canteiro? O acesso some de vez e não dá para desfazer. Os lançamentos que essa pessoa fez continuam na obra.`}
                          className="text-sm text-red-700 underline"
                        >
                          Excluir pessoa
                        </BotaoConfirmar>
                      </form>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </>
  );
}
