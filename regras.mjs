import { q } from "./db.mjs";
import { turnosDe, dataBR, faixa } from "./util.mjs";

export const SELECT_PLANTAO = `
  SELECT p.id, p.familia_id, f.apelido AS familia, f.bairro, to_char(p.data,'YYYY-MM-DD') AS data,
         p.hora, p.duracao, p.inicio, p.fim, p.valor, p.status, p.cuidadora_id, c.nome AS cuidadora_nome,
         p.prazo, p.versao, p.motivo,
         EXISTS (SELECT 1 FROM periodos_fechados pf WHERE p.data BETWEEN pf.inicio AND pf.fim) AS fechado
    FROM plantoes p
    JOIN familias f ON f.id = p.familia_id
    LEFT JOIN cuidadoras c ON c.id = p.cuidadora_id`;

// Um plantão aceito cujo horário terminou aguarda conferência da Coordenação.
export function statusEfetivo(p, agora = new Date()) {
  if (p.status === "aceito" && new Date(p.fim) <= agora) return "conferencia";
  return p.status;
}

export function saida(p, { comValor = true } = {}) {
  const agora = new Date();
  return {
    id: p.id,
    familiaId: p.familia_id,
    familia: p.familia,
    bairro: p.bairro,
    data: p.data,
    hora: p.hora,
    duracao: p.duracao,
    inicio: p.inicio,
    fim: p.fim,
    valor: comValor && p.valor != null ? Number(p.valor) : null,
    status: statusEfetivo(p, agora),
    emAndamento: p.status === "aceito" && new Date(p.inicio) <= agora && new Date(p.fim) > agora,
    cuidadoraId: p.cuidadora_id,
    cuidadora: p.cuidadora_nome,
    prazo: p.prazo,
    prazoVencido: !!(p.prazo && new Date(p.prazo) < agora && ["convite", "aberta"].includes(p.status)),
    versao: p.versao,
    motivo: p.motivo,
    fechado: p.fechado,
  };
}

export async function evento(tx, plantaoId, autor, acao, textoEvento, dados = null) {
  await tx.q(
    "INSERT INTO eventos (plantao_id, autor_tipo, autor_id, autor_nome, acao, texto, dados) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [plantaoId, autor.tipo, autor.id ?? null, autor.nomeExibicao || autor.nome, acao, textoEvento, dados ? JSON.stringify(dados) : null]
  );
}

export const descricao = (p) => `${dataBR(p.data)}, ${faixa(p.hora, p.duracao)}, ${p.familia}`;

// Avalia se uma cuidadora pode assumir o plantão p.
// Retorna { bloqueio: texto|null, avisos: [texto] }.
export async function avaliar(cx, cuidadoraIds, p, descansoMin) {
  if (!cuidadoraIds.length) return {};
  const compromissos = await cx.q(
    `SELECT p.id, p.cuidadora_id, p.inicio, p.fim, p.status, to_char(p.data,'YYYY-MM-DD') AS data, p.hora, p.duracao, f.apelido AS familia
       FROM plantoes p JOIN familias f ON f.id=p.familia_id
      WHERE p.cuidadora_id = ANY($1) AND p.id <> $2
        AND p.status IN ('aceito','novoaceite','convite','realizado')
        AND p.fim > $3::timestamptz - interval '2 days' AND p.inicio < $4::timestamptz + interval '2 days'`,
    [cuidadoraIds, p.id || 0, p.inicio, p.fim]
  );
  const indisp = await cx.q(
    "SELECT cuidadora_id, turno FROM indisponibilidades WHERE cuidadora_id = ANY($1) AND data = $2",
    [cuidadoraIds, p.data]
  );
  const turnos = turnosDe(p.hora, p.duracao);
  const r = {};
  for (const id of cuidadoraIds) {
    const av = { bloqueio: null, avisos: [] };
    const ind = indisp.filter((i) => i.cuidadora_id === id && turnos.includes(i.turno)).map((i) => i.turno);
    if (ind.length) av.avisos.push(`Informou indisponibilidade (${ind.length > 1 ? "dia todo" : ind[0]})`);
    const a1 = new Date(p.inicio), b1 = new Date(p.fim);
    for (const c of compromissos.filter((x) => x.cuidadora_id === id)) {
      const a2 = new Date(c.inicio), b2 = new Date(c.fim);
      if (a1 < b2 && a2 < b1) {
        if (c.status === "convite") av.avisos.push(`Convite pendente no mesmo horário (${descricao(c)})`);
        else av.bloqueio = `Já tem plantão no mesmo horário (${descricao(c)})`;
        continue;
      }
      if (c.status === "convite") continue;
      const intervalo = Math.min(Math.abs(a1 - b2), Math.abs(a2 - b1)) / 3600e3;
      if (intervalo < descansoMin) av.avisos.push(`Intervalo de ${Math.round(intervalo)}h até outro plantão (${descricao(c)}). Mínimo de ${descansoMin}h`);
    }
    r[id] = av;
  }
  return r;
}

export async function periodoFechado(cx, data) {
  const r = await cx.q("SELECT 1 FROM periodos_fechados WHERE $1::date BETWEEN inicio AND fim", [data]);
  return r.length > 0;
}

export async function habilitada(cx, cuidadoraId, familiaId) {
  const r = await cx.q(
    "SELECT 1 FROM habilitacoes h JOIN cuidadoras c ON c.id=h.cuidadora_id WHERE h.cuidadora_id=$1 AND h.familia_id=$2 AND c.ativa",
    [cuidadoraId, familiaId]
  );
  return r.length > 0;
}

// Devolve à Coordenação convites e plantões futuros de uma cuidadora ao revogar acesso.
export async function revogar(tx, cuidadoraId, familiaIds, motivo, autor) {
  const alvos = await tx.q(
    `SELECT id FROM plantoes WHERE cuidadora_id=$1 AND familia_id = ANY($2)
       AND status IN ('convite','novoaceite','aceito','rascunho') AND inicio > NOW()`,
    [cuidadoraId, familiaIds]
  );
  for (const a of alvos) {
    await tx.q("UPDATE plantoes SET status = CASE WHEN status='rascunho' THEN 'rascunho' ELSE 'aguardando' END, cuidadora_id=NULL, atualizado_em=NOW() WHERE id=$1", [a.id]);
    await evento(tx, a.id, autor, "revogacao", `Acesso da cuidadora revogado (${motivo}). Plantão voltou para a Coordenação.`);
  }
  return alvos.length;
}

export { q };
