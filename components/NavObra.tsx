import Link from "next/link";

const ABAS = [
  { chave: "acompanhamento", rotulo: "Acompanhamento", caminho: "", equipe: false },
  { chave: "lancamentos", rotulo: "Lançamentos", caminho: "/lancamentos", equipe: false },
  { chave: "fotos", rotulo: "Fotos", caminho: "/fotos", equipe: false },
  { chave: "importar", rotulo: "Importar notas", caminho: "/importar", equipe: true },
  { chave: "conferir", rotulo: "Conferir", caminho: "/conferir", equipe: true },
] as const;

export type Aba = (typeof ABAS)[number]["chave"];

/** Cabeçalho comum das telas da obra: voltar, nome e abas. */
export function NavObra({
  obraId,
  nome,
  atual,
  equipe,
  pendentes = 0,
  children,
}: {
  obraId: string;
  nome: string;
  atual: Aba;
  equipe: boolean;
  pendentes?: number;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <Link href="/" className="text-sm text-stone-500 underline">
        Obras
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{nome}</h1>
        {children}
      </div>
      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {ABAS.filter((a) => equipe || !a.equipe).map((a) =>
          a.chave === atual ? (
            <span key={a.chave} className="font-medium">
              {a.rotulo}
            </span>
          ) : (
            <Link key={a.chave} href={`/obras/${obraId}${a.caminho}`} className="underline text-stone-600">
              {a.rotulo}
              {a.chave === "conferir" && pendentes > 0 && (
                <span className="ml-1 text-xs bg-amber-200 text-amber-900 rounded-full px-1.5 no-underline">{pendentes}</span>
              )}
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}
