import Link from "next/link";
import { sair } from "@/app/login/actions";
import type { Perfil } from "@/lib/sessao";

export function Cabecalho({ perfil }: { perfil: Pick<Perfil, "nome" | "papel"> }) {
  return (
    <header className="topbar">
      <Link href="/" className="logo">
        <div className="mark">CA</div>
        <div>Canteiro</div>
      </Link>
      {perfil.papel === "admin" && (
        <Link href="/equipe" className="text-sm text-[#C9D8E4] hover:text-white">
          Pessoas
        </Link>
      )}
      <span className="spacer" />
      <span className="text-sm text-[#C9D8E4]">{perfil.nome}</span>
      <form action={sair}>
        <button type="submit" className="text-sm text-[#C9D8E4] underline hover:text-white">
          Sair
        </button>
      </form>
    </header>
  );
}
