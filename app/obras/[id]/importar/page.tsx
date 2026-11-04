import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { carregarObra, contarPendentes } from "@/lib/obra";
import { Cabecalho } from "@/components/Cabecalho";
import { NavObra } from "@/components/NavObra";
import { EnviarNotas } from "./EnviarNotas";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // leitura de PDF/foto pela IA leva alguns segundos por nota

export default async function ImportarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect(`/obras/${id}`);
  const obra = await carregarObra(supabase, id);
  const pendentes = await contarPendentes(supabase, id);

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
        <NavObra obraId={id} nome={obra.nome} atual="importar" equipe pendentes={pendentes} />
        <section className="bg-white rounded-xl shadow-sm p-6 flex flex-col gap-3">
          <h2 className="font-semibold">Importar notas</h2>
          <p className="text-sm text-stone-600">
            O sistema lê fornecedor, itens e valores. Frete, desconto e outras diferenças viram lançamentos próprios.
            Nada aparece para o cliente antes de você conferir e confirmar.
          </p>
          <EnviarNotas empresaId={obra.empresa_id} obraId={id} />
        </section>
      </main>
    </>
  );
}
