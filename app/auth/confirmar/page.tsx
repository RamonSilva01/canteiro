import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { BotaoEnviar } from "@/components/BotaoEnviar";

// Destino do link de convite / novo acesso. O token só é usado no clique (POST):
// leitores de link de e-mail (Safe Links do M365) abrem o GET sozinhos e queimariam o link.
async function entrar(fd: FormData) {
  "use server";
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: String(fd.get("token_hash")),
    type: String(fd.get("type")) as EmailOtpType,
  });
  if (!error) redirect("/definir-senha");
  // Link já usado (segundo clique, ou aberto de novo): se a sessão do primeiro uso está ativa, segue para dentro.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/" : "/login?erro=link");
}

export default async function Confirmar({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;
  if (!token_hash || !type) redirect("/login?erro=link");

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={entrar} className="w-full max-w-sm bg-white rounded-xl shadow-sm p-8 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Canteiro</h1>
        <p className="text-stone-600">Você recebeu acesso ao acompanhamento da obra. Clique para entrar e criar a sua senha.</p>
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <BotaoEnviar enviando="Entrando..." className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700 disabled:opacity-60">
          Entrar e criar senha
        </BotaoEnviar>
      </form>
    </main>
  );
}
