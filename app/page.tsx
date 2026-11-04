import { createClient } from "@/lib/supabase/server";
import { sair } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: perfil } = await supabase
    .from("perfis")
    .select("nome, papel")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-10">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm p-8 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-stone-900">Canteiro</h1>
        {perfil ? (
          <p className="text-stone-700">
            Olá, {perfil.nome} ({perfil.papel}).
          </p>
        ) : (
          <p className="text-stone-700">
            Login ok ({user!.email}), mas este usuário ainda não tem perfil em nenhuma
            empresa. Rode o <code>supabase/seed/bootstrap.sql</code>.
          </p>
        )}
        <form action={sair}>
          <button type="submit" className="text-sm text-stone-500 underline">
            Sair
          </button>
        </form>
      </div>
    </main>
  );
}
