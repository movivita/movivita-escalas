import { getDatabase } from "@netlify/database";
import { ESTRUTURA } from "./estrutura.mjs";

let banco;

function obterBanco() {
  if (!banco) {
    // LOCAL_DATABASE_URL existe apenas para testes fora do Netlify.
    const local = globalThis.Netlify?.env?.get?.("LOCAL_DATABASE_URL");
    banco = local ? getDatabase({ connectionString: local }) : getDatabase();
  }
  return banco;
}

let estruturaPronta = null;

// Garante que as tabelas existem. Um bloqueio evita duas criações simultâneas.
function garantirEstrutura() {
  if (!estruturaPronta) {
    estruturaPronta = (async () => {
      const c = await obterBanco().pool.connect();
      try {
        await c.query("SELECT pg_advisory_lock(7342001)");
        await c.query(ESTRUTURA);
      } finally {
        await c.query("SELECT pg_advisory_unlock(7342001)").catch(() => {});
        c.release();
      }
    })().catch((e) => { estruturaPronta = null; throw e; });
  }
  return estruturaPronta;
}

export async function q(texto, params = []) {
  await garantirEstrutura();
  const r = await obterBanco().pool.query(texto, params);
  return r.rows;
}

export async function um(texto, params = []) {
  const linhas = await q(texto, params);
  return linhas[0] || null;
}

// Executa fn(cliente) dentro de uma transação.
export async function transacao(fn) {
  await garantirEstrutura();
  const cliente = await obterBanco().pool.connect();
  try {
    await cliente.query("BEGIN");
    const tx = {
      q: async (t, p = []) => (await cliente.query(t, p)).rows,
      um: async (t, p = []) => (await cliente.query(t, p)).rows[0] || null,
    };
    const resultado = await fn(tx);
    await cliente.query("COMMIT");
    return resultado;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

export const cx = { q, um };

export async function config() {
  const linhas = await q("SELECT chave, valor FROM config");
  const c = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  return {
    descansoMin: Number(c.descanso_min_h || 11),
    mostrarValor: c.mostrar_valor !== "nao",
    prazoPadraoH: Number(c.prazo_padrao_h || 48),
    voluntariedadeVersao: c.voluntariedade_versao || "v1",
  };
}
