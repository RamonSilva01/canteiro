import Link from "next/link";
import { redirect } from "next/navigation";
import { ehEquipe, exigirPerfil } from "@/lib/sessao";
import { Cabecalho } from "@/components/Cabecalho";
import { Campo } from "@/components/Campo";
import { criarObra } from "./actions";

export default async function NovaObra({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { perfil } = await exigirPerfil();
  if (!ehEquipe(perfil)) redirect("/");
  const { erro } = await searchParams;

  return (
    <>
      <Cabecalho perfil={perfil} />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-stone-500 underline">
          Voltar
        </Link>
        <form action={criarObra} className="mt-3 bg-white rounded-xl shadow-sm p-6 flex flex-col gap-4">
          <h1 className="text-xl font-semibold">Nova obra</h1>
          <Campo rotulo="Nome da obra" name="nome" required placeholder="Residencial Portobello" />
          <Campo rotulo="Cliente (proprietário)" name="cliente_nome" />
          <Campo rotulo="Endereço" name="endereco_logradouro" />
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <Campo rotulo="Cidade" name="endereco_cidade" />
            <Campo rotulo="UF" name="endereco_uf" maxLength={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Início" name="data_inicio" type="date" />
            <Campo rotulo="Entrega prevista" name="data_entrega_prevista" type="date" />
          </div>
          <Campo rotulo="Projeção de venda (R$, opcional)" name="projecao_venda" inputMode="decimal" />
          <p className="text-sm text-stone-500">
            A obra já nasce com as etapas padrão. O orçamento e as datas de cada etapa você ajusta na tela seguinte.
          </p>
          {erro && <p className="text-sm text-red-600">Não foi possível criar a obra: {erro}</p>}
          <button type="submit" className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700">
            Criar obra
          </button>
        </form>
      </main>
    </>
  );
}
