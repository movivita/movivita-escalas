import { q, um } from "./db.mjs";
import { SELECT_PLANTAO, saida } from "./regras.mjs";
import { Erro } from "./util.mjs";
import { createHash } from "node:crypto";

const primeiroNome = (n) => (n || "").split(" ")[0];

// Extrato de plantões por cuidadora ou por família.
// A versão por família omite valores e mostra só o primeiro nome das cuidadoras.
export async function montarExtrato({ tipo, id, ini, fim, comValor, emissor }) {
  let titulo;
  if (tipo === "cuid") {
    const c = await um("SELECT nome FROM cuidadoras WHERE id=$1", [id]);
    if (!c) throw new Erro(404, "Cuidadora não encontrada.");
    titulo = `Cuidadora: ${c.nome}`;
  } else {
    const f = await um("SELECT apelido, bairro FROM familias WHERE id=$1", [id]);
    if (!f) throw new Erro(404, "Família não encontrada.");
    titulo = `${f.apelido}${f.bairro ? " • " + f.bairro : ""}`;
    comValor = false;
  }
  const filtro = tipo === "cuid" ? "p.cuidadora_id=$3" : "p.familia_id=$3";
  const linhas = await q(
    `${SELECT_PLANTAO} WHERE p.data BETWEEN $1 AND $2 AND ${filtro}
       AND p.status IN ('aceito','realizado','naorealizado') ORDER BY p.inicio`,
    [ini, fim, id]
  );
  const aceites = linhas.length
    ? await q(
        `SELECT DISTINCT ON (plantao_id) plantao_id, em FROM eventos
          WHERE acao='aceite' AND plantao_id = ANY($1) ORDER BY plantao_id, em DESC`,
        [linhas.map((l) => l.id)]
      )
    : [];
  const itens = linhas.map((p) => {
    const s = saida(p, { comValor });
    return {
      data: s.data, hora: s.hora, duracao: s.duracao, familia: s.familia,
      cuidadora: tipo === "cuid" ? s.cuidadora : primeiroNome(s.cuidadora),
      status: s.status, emAndamento: s.emAndamento, valor: s.valor, motivo: s.motivo,
      aceiteEm: aceites.find((a) => a.plantao_id === p.id)?.em || null,
    };
  });
  const imprevistos = tipo === "cuid"
    ? await q(
        `SELECT to_char(p.data,'YYYY-MM-DD') AS data, p.hora, p.duracao, f.apelido AS familia, i.horas_antes, i.em
           FROM imprevistos i JOIN plantoes p ON p.id=i.plantao_id JOIN familias f ON f.id=p.familia_id
          WHERE i.cuidadora_id=$1 AND p.data BETWEEN $2 AND $3 ORDER BY p.inicio`,
        [id, ini, fim]
      )
    : [];
  const realizados = itens.filter((i) => i.status === "realizado");
  const pendentes = itens.filter((i) => i.status === "conferencia").length;
  const fechamentos = await q(
    "SELECT to_char(inicio,'YYYY-MM-DD') AS inicio, to_char(fim,'YYYY-MM-DD') AS fim FROM periodos_fechados WHERE fim >= $1 AND inicio <= $2",
    [ini, fim]
  );
  // O período está fechado quando todos os dias estão cobertos por fechamentos.
  let dia = ini, fechado = true;
  while (dia <= fim) {
    if (!fechamentos.some((f) => dia >= f.inicio && dia <= f.fim)) { fechado = false; break; }
    const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); dia = d.toISOString().slice(0, 10);
  }
  const emitidoEm = new Date().toISOString();
  const codigo = "MV-" + createHash("sha256").update(JSON.stringify({ tipo, id, ini, fim, itens, emitidoEm })).digest("hex").slice(0, 10).toUpperCase();
  return {
    tipo, titulo, ini, fim, fechado, itens, imprevistos, comValor,
    totais: {
      realizados: realizados.length,
      horas: realizados.reduce((a, i) => a + i.duracao, 0),
      valor: comValor ? realizados.reduce((a, i) => a + (i.valor || 0), 0) : null,
      pendentes,
      plantoes: itens.length,
    },
    emitidoEm, emissor, codigo,
  };
}
