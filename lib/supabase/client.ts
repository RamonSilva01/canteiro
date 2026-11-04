import { createBrowserClient } from "@supabase/ssr";

// Cliente para Client Components. Usa só a chave publicável: quem protege o dado é a RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
