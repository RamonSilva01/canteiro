import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function definirSenha(fd: FormData) {
  "use server";
  const senha = String(fd.get("senha") ?? "");
  if (senha.length < 8) redirect("/definir-senha?erro=curta");
  if (senha !== fd.get("confirmacao")) redirect("/definir-senha?erro=diferente");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) redirect(`/definir-senha?erro=${encodeURIComponent(error.message)}`);
  redirect("/");
}

const ERROS: Record<string, string> = {
  curta: "A senha precisa ter pelo menos 8 caracteres.",
  diferente: "As duas senhas não são iguais.",
};

export default async function DefinirSenha({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={definirSenha} className="w-full max-w-sm bg-white rounded-xl shadow-sm p-8 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Crie sua senha</h1>
        <p className="text-sm text-stone-500 -mt-2">É com ela que você vai entrar no Canteiro daqui em diante.</p>
        <label className="flex flex-col gap-1 text-sm text-stone-700">
          Nova senha
          <input name="senha" type="password" required minLength={8} autoComplete="new-password" className="border border-stone-300 rounded-md px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-stone-700">
          Repita a senha
          <input name="confirmacao" type="password" required minLength={8} autoComplete="new-password" className="border border-stone-300 rounded-md px-3 py-2" />
        </label>
        {erro && <p className="text-sm text-red-600">{ERROS[erro] ?? erro}</p>}
        <button type="submit" className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700">
          Salvar e entrar
        </button>
      </form>
    </main>
  );
}
