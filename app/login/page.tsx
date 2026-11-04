import { entrar } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

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

        {erro && <p className="text-sm text-red-600">E-mail ou senha incorretos.</p>}

        <button
          type="submit"
          className="bg-stone-900 text-white rounded-md py-2 font-medium hover:bg-stone-700"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
