import { json, Erro } from "../lib/util.mjs";
import { sessaoAtual, encerrarSessao, cookieSaida } from "../lib/auth.mjs";
import { registrar as rotasCuidadora } from "../lib/rotas-cuidadora.mjs";
import { registrar as rotasCoord } from "../lib/rotas-coord.mjs";

let rotas = null;

function montarRotas() {
  const lista = [];
  const rota = (metodo, padrao, papel, fn) => {
    const re = new RegExp("^" + padrao.replace(/:(\w+)/g, "(?<$1>\\d+)") + "$");
    lista.push({ metodo, re, papel, fn });
  };
  rota("POST", "/sair", null, async ({ req }) => {
    await encerrarSessao(req);
    return { corpo: { ok: true }, cookie: cookieSaida(req) };
  });
  rotasCuidadora(rota);
  rotasCoord(rota);
  return lista;
}

export default async (req) => {
  rotas ||= montarRotas();
  const url = new URL(req.url);
  const caminho = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  try {
    const achada = rotas.find((r) => r.metodo === req.method && r.re.test(caminho));
    if (!achada) {
      const existe = rotas.some((r) => r.re.test(caminho));
      throw new Erro(existe ? 405 : 404, existe ? "Método não permitido." : "Endereço não encontrado.");
    }
    let body = {};
    if (req.method === "POST") {
      // Exigir JSON impede envios a partir de formulários de outros sites.
      if (!(req.headers.get("content-type") || "").includes("application/json")) throw new Erro(415, "Envie os dados em JSON.");
      body = (await req.json().catch(() => null)) || {};
    }
    let sessao = null;
    if (achada.papel) {
      sessao = await sessaoAtual(req);
      const papelBase = achada.papel.replace("-provisorio", "");
      if (!sessao || sessao.tipo !== papelBase) throw new Erro(401, "Sua sessão terminou. Entre novamente.");
      if (papelBase === "cuid" && sessao.provisorio && achada.papel !== "cuid-provisorio") throw new Erro(403, "Crie seu PIN pessoal para continuar.");
    }
    const params = achada.re.exec(caminho).groups || {};
    const r = await achada.fn({ req, url, body, params, sessao });
    if (r && r.cookie) return json(r.corpo, 200, { "set-cookie": r.cookie });
    return json(r ?? { ok: true });
  } catch (e) {
    if (e instanceof Erro) return json({ erro: e.message }, e.status);
    console.error(e);
    return json({ erro: "Não foi possível concluir. Tente de novo em instantes." }, 500);
  }
};

export const config = { path: "/api/*" };
