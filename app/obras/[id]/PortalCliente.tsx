import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Perfil } from "@/lib/sessao";
import { pct, reais, reaisInteiro } from "@/lib/format";
import { fotosRecentes } from "@/lib/fotos";
import { montarDados, ROTULO_SITUACAO, tetoEconometro } from "@/lib/relatorio/dados";
import { FaixaPrevia } from "@/components/NavObra";
import { sair } from "@/app/login/actions";

// Portal do cliente: o relatório mensal em PDF virado tela, sempre atualizado.
// Segue a tela "Minha obra" de docs/wireframes.html: vitrine em navy, herdada do relatório atual.

type Obra = { id: string; nome: string; cliente_nome: string | null; data_inicio: string | null; data_entrega_prevista: string | null };

const COR_SITUACAO: Record<string, string> = {
  adiantada: "var(--ok)",
  no_prazo: "var(--amber-400)",
  atrasada: "var(--bad)",
  sem_prazo: "#C9DCEA",
};

const mesAno = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00-03:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(". de ", "/").replace(" de ", "/");

function Econometro({ valor }: { valor: number }) {
  const teto = tetoEconometro(valor);
  const fracao = Math.min(Math.abs(valor) / teto, 1);
  const comprimento = 277;
  const cor = valor < 0 ? "#D9463F" : "#12A06A";
  return (
    <svg className="gauge" viewBox="0 0 220 142" role="img" aria-label={`Econômetro: ${reais(valor)}`}>
      <path d="M22 112 A88 88 0 0 1 198 112" fill="none" stroke="#173149" strokeWidth="15" strokeLinecap="round" />
      {fracao > 0 && (
        <path
          d="M22 112 A88 88 0 0 1 198 112"
          fill="none"
          stroke={cor}
          strokeWidth="15"
          strokeLinecap="round"
          strokeDasharray={comprimento}
          strokeDashoffset={comprimento * (1 - fracao)}
        />
      )}
      <g transform={`translate(110,112) rotate(${fracao * 180 - 90})`}>
        <line x1="0" y1="0" x2="0" y2="-66" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <circle cx="0" cy="0" r="7" fill="#fff" />
      </g>
      <text x="10" y="134" fill="#6E8CA5" fontSize="11">
        R$ 0
      </text>
      <text x="210" y="134" fill="#6E8CA5" fontSize="11" textAnchor="end">
        {valor < 0 ? "-" : ""}
        {reaisInteiro(teto)}
      </text>
    </svg>
  );
}

function Diferenca({ projetado, gasto }: { projetado: number; gasto: number }) {
  const dif = projetado - gasto;
  if (projetado === 0 && gasto === 0) return <div className="delta">sem lançamentos ainda</div>;
  if (dif === 0) return <div className="delta">igual ao previsto</div>;
  return (
    <div className="delta" style={{ color: dif > 0 ? "#41D69B" : "#FF8A84" }}>
      {reaisInteiro(Math.abs(dif))} {dif > 0 ? "abaixo" : "acima"} do previsto
    </div>
  );
}

export async function PortalCliente({
  supabase,
  obra,
  perfil,
  previa = false,
}: {
  supabase: SupabaseClient;
  obra: Obra;
  perfil: Perfil;
  previa?: boolean;
}) {
  const [dados, { data: ultimoLanc }, { data: ultimoAvanco }, fotos, { data: relatorio }] = await Promise.all([
    montarDados(supabase, obra),
    supabase
      .from("lancamentos")
      .select("confirmado_em")
      .eq("obra_id", obra.id)
      .not("confirmado_em", "is", null)
      .order("confirmado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("avancos_etapa").select("registrado_em").eq("obra_id", obra.id).order("registrado_em", { ascending: false }).limit(1).maybeSingle(),
    fotosRecentes(supabase, obra.id, 6),
    supabase
      .from("relatorios_mensais")
      .select("competencia, pdf_path")
      .eq("obra_id", obra.id)
      .not("publicado_em", "is", null)
      .not("pdf_path", "is", null)
      .order("competencia", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let urlPdf: string | null = null;
  if (relatorio?.pdf_path) {
    const { data } = await supabase.storage
      .from("relatorios")
      .createSignedUrl(relatorio.pdf_path, 3600, { download: `Relatorio-${String(relatorio.competencia).slice(0, 7)}.pdf` });
    urlPdf = data?.signedUrl ?? null;
  }

  const sufixoPrevia = previa ? "?ver=cliente" : "";
  const atualizado = [ultimoLanc?.confirmado_em, ultimoAvanco?.registrado_em].filter(Boolean).sort().pop();
  const { situacao, avanco_geral, avanco_esperado, diferenca_pontos, economia, custo_obra, mao_de_obra, etapas } = dados;

  // Linha do tempo: a posição vem das datas; sem datas, do avanço.
  const inicio = obra.data_inicio ? new Date(obra.data_inicio).getTime() : null;
  const fim = obra.data_entrega_prevista ? new Date(obra.data_entrega_prevista).getTime() : null;
  const temDatas = inicio != null && fim != null && fim > inicio;
  const naLinha = (d: string | number) => {
    const t = new Date(d).getTime();
    return temDatas ? Math.max(2, Math.min(98, (100 * (t - inicio!)) / (fim! - inicio!))) : avanco_geral;
  };
  const posHoje = temDatas ? naLinha(Date.now()) : Math.min(Math.max(avanco_geral, 2), 98);
  // Até três etapas concluídas, as mais recentes, sem títulos encavalados na linha.
  const DISTANCIA_MINIMA = 12;
  const concluidas = etapas
    .filter((e) => Number(e.percentual_avanco) >= 100 && e.data_fim_real)
    .sort((a, b) => String(b.data_fim_real).localeCompare(String(a.data_fim_real)))
    .reduce<{ etapa: (typeof etapas)[number]; pos: number }[]>((lista, etapa) => {
      const pos = naLinha(etapa.data_fim_real!);
      const ocupadas = [0, posHoje, 100, ...lista.map((n) => n.pos)];
      if (lista.length < 3 && ocupadas.every((p) => Math.abs(p - pos) >= DISTANCIA_MINIMA)) lista.push({ etapa, pos });
      return lista;
    }, [])
    .reverse();
  const emAndamento = etapas.find((e) => Number(e.percentual_avanco) > 0 && Number(e.percentual_avanco) < 100);
  const dinheiro = etapas
    .filter((e) => Number(e.custo_real) > 0)
    .sort((a, b) => Number(b.custo_real) - Number(a.custo_real))
    .slice(0, 5);
  const maiorGasto = Math.max(1, ...dinheiro.map((e) => Number(e.custo_real)));

  return (
    <div className="client">
      {previa && <FaixaPrevia obraId={obra.id} />}
      <header className="topbar">
        <div className="logo">
          <div className="mark">CA</div>
          <div>Canteiro</div>
        </div>
        <span className="spacer" />
        <span className="text-sm text-[#C9D8E4]">{previa ? (obra.cliente_nome ?? "Cliente") : perfil.nome}</span>
        {!previa && (
          <form action={sair}>
            <button type="submit" className="text-sm text-[#C9D8E4] underline hover:text-white">
              Sair
            </button>
          </form>
        )}
      </header>

      <main className="max-w-[1180px] mx-auto px-4 py-6 pb-16">
        <div className="page-head">
          <div>
            <h1 className="font-semibold">{obra.nome}</h1>
            <p className="sub">
              {[
                obra.cliente_nome,
                atualizado &&
                  `atualizado em ${new Date(atualizado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className="spacer" />
          {urlPdf && (
            <a href={urlPdf} className="btn btn-ghost btn-sm">
              Baixar PDF do mês
            </a>
          )}
        </div>

        <div className="status-hero mb-4">
          <div className="big">
            <div className="text-xs uppercase tracking-[.09em] text-[#8FAAC0] font-semibold mb-2">Status da obra</div>
            <div className="stamp" style={{ color: COR_SITUACAO[situacao] ?? COR_SITUACAO.sem_prazo }}>
              {ROTULO_SITUACAO[situacao] ?? ROTULO_SITUACAO.sem_prazo}
              {diferenca_pontos != null && Math.abs(diferenca_pontos) >= 0.5 && (
                <span
                  className="badge"
                  style={
                    diferenca_pontos < 0
                      ? { background: "rgba(217,70,63,.16)", borderColor: "rgba(217,70,63,.5)", color: "#FF8A84" }
                      : undefined
                  }
                >
                  {Math.abs(diferenca_pontos).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos {diferenca_pontos > 0 ? "à frente" : "atrás"}
                </span>
              )}
            </div>
            <div className="dual-bar">
              <div className="lbl">
                <span>Avanço real</span>
                <span className="num text-white font-semibold">{pct(avanco_geral)}</span>
              </div>
              <div className="track">
                <div className="real" style={{ width: `${Math.min(avanco_geral, 100)}%` }} />
                {avanco_esperado != null && <div className="proj" style={{ left: `${Math.min(avanco_esperado, 100)}%` }} />}
              </div>
              <div className="legend">
                <span>
                  <i style={{ background: "var(--amber-500)" }} />
                  Avanço real {pct(avanco_geral)}
                </span>
                {avanco_esperado != null && (
                  <span>
                    <i style={{ background: "#fff" }} />
                    Projetado para hoje {pct(avanco_esperado)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="econ min-w-[250px]">
            <Econometro valor={economia} />
            <div className="text-[11px] uppercase tracking-[.09em] text-[#8FAAC0] font-semibold">Econômetro</div>
            <div className="val num" style={economia < 0 ? { color: "#FF8A84" } : undefined}>
              {reais(economia)}
            </div>
            <div className="cap">
              {economia < 0 ? "Acima do previsto para a parte já executada" : "Economizado até aqui em relação ao previsto para a parte já executada"}
            </div>
          </div>
        </div>

        <div className="c-card mb-4">
          <div className="section-title !text-[#7E9AB2]">Linha do tempo</div>
          <div className="timeline">
            <div className="tl-track">
              <div className="tl-fill" style={{ width: `${posHoje}%` }} />
              <div className="tl-node done ini" style={{ left: "0%" }}>
                <div className="cap">
                  <b>Início</b>
                  {obra.data_inicio ? mesAno(obra.data_inicio) : "a definir"}
                </div>
                <div className="d" />
              </div>
              {concluidas.map(({ etapa: e, pos }) => (
                <div key={e.etapa_id} className="tl-node done" style={{ left: `${pos}%` }}>
                  <div className="cap">
                    <b>{e.nome}</b>
                    concluída
                  </div>
                  <div className="d" />
                </div>
              ))}
              <div className="tl-node now" style={{ left: `${posHoje}%` }}>
                <div className="cap">
                  <b>Hoje</b>
                  {emAndamento?.nome ?? ""}
                </div>
                <div className="d" />
              </div>
              <div className="tl-node fim" style={{ left: "100%" }}>
                <div className="cap">
                  <b>Entrega</b>
                  {obra.data_entrega_prevista ? mesAno(obra.data_entrega_prevista) : "a definir"}
                </div>
                <div className="d" />
              </div>
            </div>
          </div>
        </div>

        <div className="grade mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
          <div className="c-card c-kpi">
            <div className="label">Custo de obra projetado</div>
            <div className="value">{reaisInteiro(custo_obra.projetado)}</div>
            <div className="delta">materiais e serviços</div>
          </div>
          <div className="c-card c-kpi">
            <div className="label">Custo de obra gasto</div>
            <div className="value">{reaisInteiro(custo_obra.gasto)}</div>
            <Diferenca projetado={custo_obra.projetado} gasto={custo_obra.gasto} />
          </div>
          <div className="c-card c-kpi">
            <div className="label">Mão de obra projetada</div>
            <div className="value">{reaisInteiro(mao_de_obra.projetado)}</div>
            <div className="delta">empreitadas contratadas</div>
          </div>
          <div className="c-card c-kpi">
            <div className="label">Mão de obra gasta</div>
            <div className="value">{reaisInteiro(mao_de_obra.gasto)}</div>
            <Diferenca projetado={mao_de_obra.projetado} gasto={mao_de_obra.gasto} />
          </div>
        </div>

        <div className="grade g-2">
          <div className="c-card">
            <div className="flex items-center gap-2.5 mb-3.5">
              <div className="section-title !text-[#7E9AB2] !m-0">Últimas fotos</div>
              <span className="flex-1" />
              <Link href={`/obras/${obra.id}/fotos${sufixoPrevia}`} className="btn btn-sm" style={{ background: "#16324D", color: "#C9DCEA" }}>
                Ver todas
              </Link>
            </div>
            {fotos.length === 0 ? (
              <p className="text-sm text-[#8FAAC0]">As fotos da obra aparecem aqui.</p>
            ) : (
              <div className="photos">
                {fotos.map((f) => (
                  <div key={f.id} className="photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.legenda ?? "Foto da obra"} />
                    {f.legenda && <span>{f.legenda}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="c-card">
            <div className="section-title !text-[#7E9AB2]">Onde está o dinheiro</div>
            <div className="flex flex-col gap-[13px] mt-3">
              {dinheiro.length === 0 && <p className="text-sm text-[#8FAAC0]">Nenhuma compra lançada ainda.</p>}
              {dinheiro.map((e) => (
                <div key={e.etapa_id}>
                  <div className="flex justify-between text-[13px] mb-[5px]">
                    <span>{e.nome}</span>
                    <span className="num text-white">{reaisInteiro(e.custo_real)}</span>
                  </div>
                  <div className="bar" style={{ background: "#0C2237" }}>
                    <i style={{ width: `${(100 * Number(e.custo_real)) / maiorGasto}%`, background: "var(--amber-500)" }} />
                  </div>
                </div>
              ))}
            </div>
            <Link
              href={`/obras/${obra.id}/lancamentos${sufixoPrevia}`}
              className="btn btn-sm w-full justify-center mt-4"
              style={{ background: "#16324D", color: "#C9DCEA" }}
            >
              Ver todos os lançamentos
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
