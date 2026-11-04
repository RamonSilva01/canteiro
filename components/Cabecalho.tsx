import Link from "next/link";
import { sair } from "@/app/login/actions";
import type { Perfil } from "@/lib/sessao";

export function Cabecalho({ perfil }: { perfil: Pick<Perfil, "nome" | "papel"> }) {
  return (
    <header className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Link href="/" className="font-semibold text-stone-900">
            Canteiro
          </Link>
          {perfil.papel === "admin" && (
            <Link href="/equipe" className="text-sm text-stone-600 underline">
              Pessoas
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-stone-600">
          <span>{perfil.nome}</span>
          <form action={sair}>
            <button type="submit" className="underline hover:text-stone-900">
              Sair
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
