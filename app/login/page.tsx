import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { entrar } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  // Quem já está logado (ex.: abriu o link do convite de novo) vai direto para as obras.
  if (erro !== "desligado") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-100 px-4">
      <form
        action={entrar}
        className="w-full max-w-sm bg-white rounded-xl shadow-sm p-8 flex flex-col gap-4"
      >
        <h1 className="text-2xl font-semibold text-stone-900">Canteiro</h1>
        <p className="text-sm text-stone-500 -mt-2">Acompanhamento de obra</p>

        <label className="flex flex-col gap-1 text-sm text-stone-700">
          E-mail
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border border-stone-300 rounded-md px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-stone-700">
          Senha
          <input
            name="senha"
            type="password"
            required
            autoComplete="current-password"
            className="border border-stone-300 rounded-md px-3 py-2"
          />
        </label>

        {erro && (
          <p className="text-sm text-red-600">
            {erro === "link"
              ? "Este link de acesso já foi usado ou venceu. Se você já criou sua senha, é só entrar aqui com seu e-mail e senha. Se ainda não criou, peça um novo link ao administrador da obra."
              : erro === "desligado"
                ? "Seu acesso foi desligado pelo administrador da obra."
                : "E-mail ou senha incorretos."}
          </p>
        )}

        <button
          type="submit"
          className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700"
        >
          Entrar
        </button>
        <p className="text-xs text-stone-500 text-center">Esqueceu a senha? Peça um novo link de acesso ao administrador.</p>
      </form>
    </main>
  );
}
