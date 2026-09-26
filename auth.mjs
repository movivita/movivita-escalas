import { randomBytes, scryptSync, timingSafeEqual, createHash, randomInt } from "node:crypto";
import { q, um } from "./db.mjs";
import { Erro } from "./util.mjs";

const COOKIE = "mv_sessao";
const DURACAO = { cuid: 30 * 24 * 3600e3, coord: 7 * 24 * 3600e3 };
const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;

export function gerarHash(segredo) {
  const sal = randomBytes(16);
  const h = scryptSync(String(segredo), sal, 32);
  return `scrypt$${sal.toString("base64")}$${h.toString("base64")}`;
}

export function conferirHash(segredo, armazenado) {
  const [, salB64, hB64] = String(armazenado).split("$");
  if (!salB64 || !hB64) return false;
  const esperado = Buffer.from(hB64, "base64");
  const h = scryptSync(String(segredo), Buffer.from(salB64, "base64"), esperado.length);
  return timingSafeEqual(h, esperado);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function pinProvisorio() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function pinFraco(pin) {
  if (!/^\d{4,6}$/.test(pin)) return "O PIN precisa ter de 4 a 6 números.";
  if (/^(\d)\1+$/.test(pin)) return "Evite repetir o mesmo número.";
  const seq = "0123456789012345", inv = "9876543210987654";
  if (seq.includes(pin) || inv.includes(pin)) return "Evite números em sequência.";
  return null;
}

export async function verificarBloqueio(chave) {
  const t = await um("SELECT falhas, bloqueado_ate FROM tentativas WHERE chave=$1", [chave]);
  if (t?.bloqueado_ate && new Date(t.bloqueado_ate) > new Date()) {
    throw new Erro(429, `Acesso bloqueado por ${BLOQUEIO_MIN} minutos após ${MAX_FALHAS} tentativas. Tente mais tarde ou fale com a Coordenação.`);
  }
}

export async function registrarFalha(chave) {
  const r = await um(
    `INSERT INTO tentativas (chave, falhas) VALUES ($1, 1)
     ON CONFLICT (chave) DO UPDATE SET falhas = CASE WHEN tentativas.bloqueado_ate IS NOT NULL AND tentativas.bloqueado_ate < NOW() THEN 1 ELSE tentativas.falhas + 1 END,
       bloqueado_ate = CASE WHEN tentativas.bloqueado_ate IS NOT NULL AND tentativas.bloqueado_ate < NOW() THEN NULL ELSE tentativas.bloqueado_ate END
     RETURNING falhas`,
    [chave]
  );
  if (r.falhas >= MAX_FALHAS) {
    await q(`UPDATE tentativas SET bloqueado_ate = NOW() + interval '${BLOQUEIO_MIN} minutes' WHERE chave=$1`, [chave]);
  }
  return MAX_FALHAS - r.falhas;
}

export async function limparFalhas(chave) {
  await q("DELETE FROM tentativas WHERE chave=$1", [chave]);
}

export async function criarSessao(tipo, usuarioId, req) {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DURACAO[tipo]);
  await q("INSERT INTO sessoes (token_hash, tipo, usuario_id, expira_em) VALUES ($1,$2,$3,$4)", [sha(token), tipo, usuarioId, expira]);
  await q("DELETE FROM sessoes WHERE expira_em < NOW()");
  await q("INSERT INTO acessos (tipo, usuario_id, acao) VALUES ($1,$2,'entrada')", [tipo, usuarioId]);
  return cookieSessao(token, expira, req);
}

function seguro(req) {
  return new URL(req.url).protocol === "https:";
}

function cookieSessao(token, expira, req) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expira.toUTCString()}${seguro(req) ? "; Secure" : ""}`;
}

export function cookieSaida(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${seguro(req) ? "; Secure" : ""}`;
}

function lerToken(req) {
  const c = req.headers.get("cookie") || "";
  const m = c.split(/;\s*/).find((p) => p.startsWith(COOKIE + "="));
  return m ? m.slice(COOKIE.length + 1) : null;
}

export async function sessaoAtual(req) {
  const token = lerToken(req);
  if (!token) return null;
  const s = await um("SELECT tipo, usuario_id FROM sessoes WHERE token_hash=$1 AND expira_em > NOW()", [sha(token)]);
  if (!s) return null;
  if (s.tipo === "cuid") {
    const u = await um("SELECT id, nome, ativa, pin_provisorio FROM cuidadoras WHERE id=$1", [s.usuario_id]);
    if (!u || !u.ativa) return null;
    return { tipo: "cuid", id: u.id, nome: u.nome, provisorio: u.pin_provisorio, token };
  }
  const u = await um("SELECT id, nome, email, ativo FROM coordenadores WHERE id=$1", [s.usuario_id]);
  if (!u || !u.ativo) return null;
  return { tipo: "coord", id: u.id, nome: u.nome, email: u.email, token };
}

export async function encerrarSessao(req) {
  const token = lerToken(req);
  if (token) await q("DELETE FROM sessoes WHERE token_hash=$1", [sha(token)]);
}

export async function encerrarSessoesDe(tipo, usuarioId) {
  await q("DELETE FROM sessoes WHERE tipo=$1 AND usuario_id=$2", [tipo, usuarioId]);
}
