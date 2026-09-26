// Utilidades de data, resposta e validação.
// A Movivita opera em Goiânia (America/Sao_Paulo, UTC-3, sem horário de verão desde 2019).

export const FUSO = "-03:00";

export const TEXTO_VOLUNTARIEDADE = {
  v1: "Você é livre para aceitar ou recusar este plantão. A recusa não precisa de justificativa e não traz nenhuma consequência.",
};
export const TEXTO_COMPROMISSO = "Ao aceitar, você assume o compromisso com este atendimento.";

export class Erro extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const pad = (n) => String(n).padStart(2, "0");

export function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function inicioDe(data, hora) {
  return new Date(`${data}T${pad(hora)}:00:00${FUSO}`);
}

export function fimDe(data, hora, duracao) {
  return new Date(inicioDe(data, hora).getTime() + duracao * 3600e3);
}

export function addDias(data, n) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function segundaDe(data) {
  const d = new Date(`${data}T12:00:00Z`);
  const dow = d.getUTCDay();
  return addDias(data, dow === 0 ? -6 : 1 - dow);
}

export function dataBR(data) {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export function faixa(hora, duracao) {
  return `${pad(hora)}h às ${pad((hora + duracao) % 24)}h`;
}

export function turnosDe(hora, duracao) {
  if (duracao >= 24) return ["dia", "noite"];
  return hora >= 17 || hora < 5 ? ["noite"] : ["dia"];
}

export function dataValida(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T12:00:00Z`));
}

export function inteiro(v, min, max, nome) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Erro(400, `${nome} inválido.`);
  return n;
}

export function texto(v, nome, { obrigatorio = true, max = 200 } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (obrigatorio && !s) throw new Erro(400, `Informe ${nome}.`);
  if (s.length > max) throw new Erro(400, `${nome} muito longo.`);
  return s;
}

export function soDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

export function formatarCelular(d) {
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
