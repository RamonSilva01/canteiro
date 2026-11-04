import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente com a chave secreta: IGNORA a RLS. Só para Route Handlers
// (convite de usuário, import de nota, geração de PDF). Nunca em código de browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
