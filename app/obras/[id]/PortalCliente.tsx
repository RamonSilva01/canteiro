import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Perfil } from "@/lib/sessao";
import { dataBR, pct, reais } from "@/lib/format";
import { fotosRecentes } from "@/lib/fotos";
import { sair } from "@/app/login/actions";

// Portal do cliente: o relatório mensal em PDF virado tela, sempre atualizado.
// Tema escuro de propósito (docs/04-ux-notas.md): o cliente sabe na hora que está "no relatório".

type Obra = { id: string; nome: string; data_inicio: string | null; data_entrega_prevista: string | null };

const MANCHETE: Record<string, [string, string]> = {
  adiantada: ["ADIANTADA", "text-emerald-300"],
  no_prazo: ["NO PRAZO", "text-amber-300"],
  atrasada: ["ATRASADA", "text-red-300"],
  sem_prazo: ["EM ANDAMENTO", "text-slate-200"],
};

export async function PortalCliente({ supabase, obra, perfil }: { supabase: SupabaseClient; obra: Obra; perfil: Perfil }) {
  const [{ data: resumo }, { data: etapas }, { data: ultimoLanc }, { data: ultimoAvanco }, fotos] = await Promise.all([
    supabase.from("vw_obras_consolidadas").select("*").eq("id", obra.id).maybeSingle(),
    supabase
      .from("vw_etapas_consolidadas")
      .select("etapa_id, nome, percentual_avanco, custo_real, orcamento_referencia, data_fim_real")
      .eq("obra_id", obra.id)
      .order("ordem"),
    supabase.from("lancamentos").select("confirmado_em").eq("obra_id", obra.id).order("confirmado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("avancos_etapa").select("registrado_em").eq("obra_id", obra.id).order("registrado_em", { ascending: false }).limit(1).maybeSingle(),
    fotosRecentes(supabase, obra.id, 6),
  ]);

  const situacao = resumo?.situacao_prazo ?? "sem_prazo";
  const [manchete, corManchete] = MANCHETE[situacao] ?? MANCHETE.sem_prazo;
  const diferenca =
    resumo?.avanco_esperado != null ? Number(resumo.avanco_real_planejado) - Number(resumo.avanco_esperado) : null;
  const economia = Number(resumo?.economia_total ?? 0);
  const atualizado = [ultimoLanc?.confirmado_em, ultimoAvanco?.registrado_em].filter(Boolean).sort().pop();
  const concluidas = (etapas ?? []).filter((e) => Number(e.percentual_avanco) >= 100 && e.data_fim_real);
  const maiorGasto = Math.max(1, ...(etapas ?? []).map((e) => Number(e.custo_real)));

  return (
    <div className="min-h-screen bg-[#0B1D2E] text-slate-100">
      <header className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between text-sm">
        <span className="font-semibold">Canteiro</span>
        <div className="flex items-center gap-4 text-slate-300">
          <span>{perfil.nome}</span>
          <form action={sair}>
            <button type="submit" className="underline">
              Sair
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-12 flex flex-col gap-6">
        <section className="pt-4">
          <p className="text-sm text-slate-400">Sua obra</p>
          <h1 className="text-3xl font-semibold">{obra.nome}</h1>
          <p className={`mt-3 text-2xl font-bold tracking-wide ${corManchete}`}>
            {manchete}
            {diferenca != null && Math.abs(diferenca) >= 0.5 && (
              <span className="ml-3 text-sm font-medium text-slate-300">
                {Math.abs(diferenca).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos{" "}
                {diferenca > 0 ? "à frente" : "atrás"} do previsto
              </span>
            )}
          </p>
          {atualizado && (
            <p className="text-xs text-slate-400 mt-1">
              Atualizado em {new Date(atualizado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </section>

        <section className="bg-white/5 rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-sm text-slate-400">Avanço da obra</p>
              <p className="text-4xl font-semibold num">{pct(resumo?.avanco_geral ?? 0)}</p>
            </div>
            {resumo?.avanco_esperado != null && (
              <p className="text-sm text-slate-400">previsto para hoje: {pct(resumo.avanco_esperado)}</p>
            )}
          </div>
          <div className="relative h-3 rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#F5852A]"
              style={{ width: `${Math.min(Number(resumo?.avanco_geral ?? 0), 100)}%` }}
            />
            {resumo?.avanco_esperado != null && (
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-white" style={{ left: `${Math.min(Number(resumo.avanco_esperado), 100)}%` }} />
            )}
          </div>
          <div className="flex justify-between text-xs text-slate-400">
            <span>Início {dataBR(obra.data_inicio)}</span>
            <span>Entrega prevista {dataBR(obra.data_entrega_prevista)}</span>
          </div>
        </section>

        <section className="grid md:grid-cols-[1.2fr_1fr] gap-4">
          <div className={`rounded-2xl p-5 ${economia < 0 ? "bg-red-500/15" : "bg-emerald-500/15"}`}>
            <p className="text-sm text-slate-300">Econômetro</p>
            <p className={`text-4xl font-semibold num ${economia < 0 ? "text-red-300" : "text-emerald-300"}`}>
              {economia > 0 ? "+" : ""}
              {reais(economia)}
            </p>
            <p className="text-sm text-slate-300 mt-1">
              {economia >= 0
                ? "Economia gerada até agora em relação ao orçamento da parte já executada."
                : "Gasto acima do orçamento previsto para a parte já executada."}
            </p>
          </div>
          <dl className="bg-white/5 rounded-2xl p-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-400">Orçamento total</dt>
              <dd className="text-lg num">{reais(resumo?.orcamento_total)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Previsto até aqui</dt>
              <dd className="text-lg num">{reais(resumo?.custo_projetado_total)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Gasto até aqui</dt>
              <dd className="text-lg num">{reais(resumo?.custo_real_total)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Compras</dt>
              <dd>
                <Link href={`/obras/${obra.id}/lancamentos`} className="text-[#F5852A] underline">
                  ver nota por nota
                </Link>
              </dd>
            </div>
          </dl>
        </section>

        <section className="bg-white/5 rounded-2xl p-5 flex flex-col gap-4">
          <h2 className="font-semibold">Etapas</h2>
          {(etapas ?? []).map((e) => (
            <div key={e.etapa_id} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{e.nome}</span>
                <span className="num text-slate-300">{pct(e.percentual_avanco)}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-[#F5852A]" style={{ width: `${Math.min(Number(e.percentual_avanco), 100)}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className="bg-white/5 rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Onde está o dinheiro</h2>
          {(etapas ?? [])
            .filter((e) => Number(e.custo_real) > 0)
            .map((e) => (
              <div key={e.etapa_id} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-sm">
                <span className="truncate">{e.nome}</span>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-slate-300" style={{ width: `${(100 * Number(e.custo_real)) / maiorGasto}%` }} />
                </div>
                <span className="num text-right">{reais(e.custo_real)}</span>
              </div>
            ))}
        </section>

        <section className="bg-white/5 rounded-2xl p-5">
          <h2 className="font-semibold mb-3">Linha do tempo</h2>
          <ol className="border-l border-white/20 pl-4 flex flex-col gap-3 text-sm">
            {obra.data_inicio && <li>{dataBR(obra.data_inicio)} · Início da obra</li>}
            {concluidas
              .sort((a, b) => String(a.data_fim_real).localeCompare(String(b.data_fim_real)))
              .map((e) => (
                <li key={e.etapa_id}>
                  {dataBR(e.data_fim_real)} · {e.nome} concluída
                </li>
              ))}
            <li className="text-[#F5852A]">Hoje</li>
            {obra.data_entrega_prevista && <li className="text-slate-400">{dataBR(obra.data_entrega_prevista)} · Entrega prevista</li>}
          </ol>
        </section>

        <section className="bg-white/5 rounded-2xl p-5">
          <div className="flex justify-between mb-3">
            <h2 className="font-semibold">Fotos recentes</h2>
            <Link href={`/obras/${obra.id}/fotos`} className="text-sm text-[#F5852A] underline">
              ver todas
            </Link>
          </div>
          {fotos.length === 0 ? (
            <p className="text-sm text-slate-400">As fotos da obra aparecem aqui.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {fotos.map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f.id} src={f.url} alt={f.legenda ?? "Foto da obra"} className="aspect-square object-cover rounded-lg" />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
