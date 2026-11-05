import "server-only";
import path from "node:path";
import { Circle, Document, Font, G, Line, Page, Path, Polygon, Rect, Svg, Text, View, renderToBuffer, StyleSheet } from "@react-pdf/renderer";
import { ROTULO_SITUACAO, type DadosRelatorio } from "./dados";

// Mesmo layout do PDF mensal que o Kristian já manda aos clientes: capa + uma página de números.

const fonte = (arquivo: string) => path.join(process.cwd(), "lib/relatorio/fonts", arquivo);
Font.register({
  family: "Montserrat",
  fonts: [
    { src: fonte("Montserrat-Regular.ttf"), fontWeight: 400 },
    { src: fonte("Montserrat-SemiBold.ttf"), fontWeight: 600 },
    { src: fonte("Montserrat-Bold.ttf"), fontWeight: 700 },
    { src: fonte("Montserrat-ExtraBold.ttf"), fontWeight: 800 },
  ],
});
Font.registerHyphenationCallback((palavra) => [palavra]);

const NAVY = "#10202F";
const CLARO = "#D9D9D9";
const LARANJA = "#F75D27";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataCurta = (d: string | null) => {
  if (!d) return "a definir";
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${MESES[Number(m) - 1].slice(0, 3)} ${dia} / ${a}`;
};
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const proporcao = (v: number, maior: number) => (maior > 0 ? Math.max(v / maior, v > 0 ? 0.01 : 0) : 0);

const s = StyleSheet.create({
  pagina: { backgroundColor: NAVY, color: CLARO, fontFamily: "Montserrat", position: "relative" },
  centro: { textAlign: "center" },
});

function Capa({ competencia, cliente }: { competencia: string; cliente: string }) {
  const [ano, mes] = competencia.split("-");
  return (
    <Page size="A4" style={s.pagina}>
      <Svg width={595} height={841} style={{ position: "absolute", top: 0, left: 0 }}>
        <Polygon points="477,334 620,417 620,500 477,417 345,494 345,620 283,655 283,453" fill="#283848" />
        <Polygon points="477,465 560,512 560,607 477,652 396,607 396,512" fill="#2A2730" />
        <Polygon points="345,636 470,708 570,650 595,665 595,842 345,842 345,785 595,785 595,750 470,780 283,672 283,842 221,842 221,700" fill="#283848" />
        <Rect x={60} y={0} width={143} height={211} rx={3} fill={CLARO} />
        <Rect x={60} y={817} width={143} height={25} rx={3} fill={CLARO} />
        <Rect x={0} y={597} width={200} height={1} fill={LARANJA} />
        <Rect x={200} y={596} width={32} height={3} rx={1.5} fill={LARANJA} />
      </Svg>
      <View style={{ position: "absolute", left: 58, top: 222 }}>
        <Text style={{ fontSize: 112, fontWeight: 800, lineHeight: 1 }}>{ano.slice(0, 2)}</Text>
        <Text style={{ fontSize: 112, fontWeight: 800, lineHeight: 1, marginTop: 2 }}>{ano.slice(2)}</Text>
      </View>
      <View style={{ position: "absolute", left: 60, top: 622, right: 30 }}>
        <Text style={{ fontSize: 31, textTransform: "uppercase" }}>{MESES[Number(mes) - 1]}</Text>
        <Text style={{ fontSize: 56, fontWeight: 800, lineHeight: 1 }}>RELATÓRIO</Text>
        <Text style={{ fontSize: 24, fontWeight: 700, marginTop: 6, textTransform: "uppercase" }}>{cliente}</Text>
      </View>
    </Page>
  );
}

function Regua({ dados }: { dados: DadosRelatorio }) {
  const x0 = 100;
  const x1 = 518;
  const inicio = dados.obra.data_inicio ? new Date(dados.obra.data_inicio).getTime() : null;
  const fim = dados.obra.data_entrega_prevista ? new Date(dados.obra.data_entrega_prevista).getTime() : null;
  const agora = new Date(dados.gerado_em).getTime();
  const fracao = inicio != null && fim != null && fim > inicio ? Math.max(0, Math.min(1, (agora - inicio) / (fim - inicio))) : Math.min(dados.avanco_geral / 100, 1);
  const pino = x0 + (x1 - x0) * fracao;
  const riscos = Array.from({ length: 34 }, (_, i) => x0 + ((x1 - x0) * i) / 33);
  return (
    <View style={{ height: 150, position: "relative" }}>
      <Text style={{ position: "absolute", left: 8, top: 72, fontSize: 12, fontWeight: 700, transform: "rotate(-90deg)", width: 80, textAlign: "center", color: "#fff" }}>Progresso</Text>
      <Svg width={595} height={150} style={{ position: "absolute", top: 0, left: 0 }}>
        {riscos.map((x, i) => (
          <Line key={i} x1={x} x2={x} y1={i % 5 === 0 ? 100 : 104} y2={i % 5 === 0 ? 121 : 116} stroke={CLARO} strokeWidth={i % 5 === 0 ? 1.6 : 1.1} />
        ))}
        <G transform={`translate(${pino}, 66)`}>
          <Path d="M0 30 C-3 22 -9 16 -9 9 A9 9 0 0 1 9 9 C9 16 3 22 0 30 Z" fill={LARANJA} />
          <Circle cx={0} cy={9} r={3.4} fill={NAVY} />
        </G>
      </Svg>
      <Text style={{ position: "absolute", left: 70, top: 84, fontSize: 7, fontWeight: 700 }}>{dataCurta(dados.obra.data_inicio)}</Text>
      <Text style={{ position: "absolute", right: 45, top: 84, fontSize: 7, fontWeight: 700 }}>{dataCurta(dados.obra.data_entrega_prevista)}</Text>
      <Text style={{ position: "absolute", left: pino - 45, width: 90, top: 50, fontSize: 7, fontWeight: 700, textAlign: "center" }}>{dataCurta(dados.gerado_em)}</Text>
    </View>
  );
}

function BarraAvanco({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, paddingLeft: 100 }}>
      <Text style={{ width: 96, fontSize: 9, fontWeight: 700, textAlign: "center", color: "#fff", lineHeight: 1 }}>{rotulo}</Text>
      <View style={{ width: 205, height: 8, marginLeft: 10, borderRadius: 4, backgroundColor: "#1F3346" }}>
        <View style={{ width: 205 * Math.min((valor ?? 0) / 100, 1), height: 8, borderRadius: 4, backgroundColor: LARANJA }} />
      </View>
      <Text style={{ fontSize: 20, marginLeft: 22 }}>{valor == null ? "-" : pct(valor)}</Text>
    </View>
  );
}

function Legenda({ a, b, tamanho }: { a: string; b: string; tamanho: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: CLARO }} />
      <Text style={{ fontSize: tamanho, marginLeft: 5, marginRight: 14 }}>{a}</Text>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LARANJA }} />
      <Text style={{ fontSize: tamanho, marginLeft: 5 }}>{b}</Text>
    </View>
  );
}

function Econometro({ valor }: { valor: number }) {
  // Ponteiro: centro = sem diferença; direita = economia; esquerda = gasto acima do previsto.
  const teto = Math.max(Math.abs(valor) * 1.5, 1000);
  const angulo = (Math.max(-1, Math.min(1, valor / teto)) * 90 - 90) * (Math.PI / 180);
  const cx = 50;
  const cy = 50;
  const px = cx + Math.cos(angulo) * 26;
  const py = cy + Math.sin(angulo) * 26;
  return (
    <Svg width={100} height={62}>
      <Path d="M8 50 A42 42 0 0 1 29 13.6" stroke="#EF3F4A" strokeWidth={9} fill="none" />
      <Path d="M31 12.5 A42 42 0 0 1 69 12.5" stroke="#F7C948" strokeWidth={9} fill="none" />
      <Path d="M71 13.6 A42 42 0 0 1 92 50" stroke="#4CB963" strokeWidth={9} fill="none" />
      <Line x1={cx} y1={cy} x2={px} y2={py} stroke={CLARO} strokeWidth={3} />
      <Circle cx={cx} cy={cy} r={6} fill={CLARO} />
    </Svg>
  );
}

function Numeros({ dados }: { dados: DadosRelatorio }) {
  const { custo_obra: co, mao_de_obra: mo } = dados;
  const maiorCusto = Math.max(co.projetado, co.gasto);
  const maiorMo = Math.max(mo.projetado, mo.gasto);
  const larguraMax = 385;
  const alturaMax = 92;
  return (
    <Page size="A4" style={[s.pagina, { paddingTop: 30 }]}>
      <Regua dados={dados} />
      <View style={{ marginTop: 22 }}>
        <BarraAvanco rotulo="Projeção para data atual" valor={dados.avanco_esperado} />
        <BarraAvanco rotulo="Avanço real" valor={dados.avanco_geral} />
      </View>
      <Text style={[s.centro, { fontSize: 11, fontWeight: 700, color: "#fff", marginTop: 12 }]}>STATUS</Text>
      <Text style={[s.centro, { fontSize: 18, fontWeight: 700, color: LARANJA, marginTop: 4 }]}>{ROTULO_SITUACAO[dados.situacao] ?? ROTULO_SITUACAO.sem_prazo}</Text>

      <Text style={[s.centro, { fontSize: 21, fontWeight: 800, marginTop: 34, marginBottom: 14 }]}>CUSTO DE OBRA</Text>
      <Legenda a="Valor Projetado" b="Valor Gasto" tamanho={9} />
      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <View style={{ width: 36 + larguraMax * proporcao(co.projetado, maiorCusto), height: 30, backgroundColor: CLARO, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
          <Text style={{ fontSize: 9, marginLeft: 4 }}>{brl(co.projetado)}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 36 + larguraMax * proporcao(co.gasto, maiorCusto), height: 30, backgroundColor: LARANJA, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
          <Text style={{ fontSize: 9, marginLeft: 4 }}>{brl(co.gasto)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", marginTop: 62, height: 225 }}>
        <View style={{ width: 300, paddingLeft: 58 }}>
          <Text style={{ fontSize: 15, fontWeight: 700, marginLeft: 12 }}>MÃO DE OBRA</Text>
          <View style={{ marginTop: 12, marginLeft: 0, alignSelf: "flex-start" }}>
            <Legenda a="Projetado" b="Gasto" tamanho={10} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: alturaMax + 18, marginTop: 8 }}>
            {[
              { valor: mo.projetado, cor: CLARO, texto: NAVY },
              { valor: mo.gasto, cor: LARANJA, texto: "#fff" },
            ].map((c) => (
              <View
                key={c.cor}
                style={{
                  width: 84,
                  marginRight: 4,
                  height: Math.max(alturaMax * proporcao(c.valor, maiorMo), 18),
                  backgroundColor: c.cor,
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  paddingTop: 4,
                }}
              >
                <Text style={{ fontSize: 8, textAlign: "center", color: c.texto }}>{brl(c.valor)}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ width: 2, backgroundColor: LARANJA }} />
        <View style={{ flex: 1, alignItems: "center", paddingTop: 42 }}>
          <Econometro valor={dados.economia} />
          <Text style={{ fontSize: 17, fontWeight: 700, marginTop: 2, color: "#fff" }}>Econômetro</Text>
          <Text style={{ fontSize: 17, fontWeight: 700, marginTop: 14, color: dados.economia < 0 ? "#FF8A84" : "#fff" }}>{brl(dados.economia)}</Text>
        </View>
      </View>
    </Page>
  );
}

export function gerarPdfRelatorio(dados: DadosRelatorio, competencia: string) {
  const cliente = dados.obra.cliente_nome ?? dados.obra.nome;
  return renderToBuffer(
    <Document title={`Relatório ${competencia.slice(0, 7)} · ${cliente}`} author="Canteiro">
      <Capa competencia={competencia} cliente={cliente} />
      <Numeros dados={dados} />
    </Document>,
  );
}
