import { q, um, transacao, config, cx } from "./db.mjs";
import {
  Erro, soDigitos, formatarCelular, hojeSP, addDias, segundaDe, dataBR, faixa, dataValida, inteiro, texto,
  inicioDe, fimDe,
} from "./util.mjs";
import {
  verificarBloqueio, registrarFalha, limparFalhas, criarSessao, conferirHash, gerarHash, pinProvisorio, encerrarSessoesDe,
} from "./auth.mjs";
import { SELECT_PLANTAO, saida, evento, avaliar, habilitada, revogar, periodoFechado } from "./regras.mjs";
import { avisar } from "./push.mjs";
import { montarExtrato } from "./extrato.mjs";

const autorDe = (s) => ({ tipo: "coord", id: s.id, nome: s.nome, nomeExibicao: `Coordenação (${s.nome})` });
const desc = (p) => `${p.familia}, ${dataBR(p.data)}, ${faixa(p.hora, p.duracao)}`;
const segundaValida = (v) => {
  if (!dataValida(v)) throw new Erro(400, "Semana inválida.");
  return segundaDe(v);
};
const ESTADOS_OFERTAVEIS = ["rascunho", "convite", "aberta", "aguardando", "novoaceite"];

async function carregar(tx, id) {
  const p = await tx.um(`${SELECT_PLANTAO} WHERE p.id=$1 FOR UPDATE OF p`, [id]);
  if (!p) throw new Erro(404, "Plantão não encontrado.");
  return p;
}

function exigirFuturo(p) {
  if (new Date(p.inicio) <= new Date()) throw new Erro(409, "Este plantão já começou.");
}

function prazoPadrao(cfg, inicio) {
  const prazo = new Date(Date.now() + cfg.prazoPadraoH * 3600e3);
  const limite = new Date(new Date(inicio).getTime() - 2 * 3600e3);
  return prazo < limite ? prazo : limite;
}

export function registrar(rota) {
  // ---------- acesso ----------
  rota("GET", "/coord/setup", null, async () => {
    const r = await um("SELECT COUNT(*)::int AS n FROM coordenadores");
    return { precisaSetup: r.n === 0 };
  });

  rota("POST", "/coord/setup", null, async ({ body, req }) => {
    const esperado = Netlify.env.get("SETUP_TOKEN");
    if (!esperado) throw new Erro(403, "Defina a variável SETUP_TOKEN no Netlify para o primeiro acesso.");
    if (body.token !== esperado) throw new Erro(403, "Código de instalação incorreto.");
    const r = await um("SELECT COUNT(*)::int AS n FROM coordenadores");
    if (r.n > 0) throw new Erro(409, "O primeiro acesso já foi configurado.");
    const nome = texto(body.nome, "o nome", { max: 80 });
    const email = texto(body.email, "o e-mail", { max: 120 }).toLowerCase();
    if (String(body.senha || "").length < 8) throw new Erro(400, "A senha precisa ter pelo menos 8 caracteres.");
    const c = await um("INSERT INTO coordenadores (nome, email, senha_hash) VALUES ($1,$2,$3) RETURNING id", [nome, email, gerarHash(body.senha)]);
    const cookie = await criarSessao("coord", c.id, req);
    return { corpo: { ok: true }, cookie };
  });

  rota("POST", "/coord/entrar", null, async ({ body, req }) => {
    const email = String(body.email || "").trim().toLowerCase();
    const chave = "email:" + email;
    await verificarBloqueio(chave);
    const c = await um("SELECT id, senha_hash, ativo FROM coordenadores WHERE email=$1", [email]);
    if (!c || !c.ativo || !conferirHash(String(body.senha || ""), c.senha_hash)) {
      const restam = await registrarFalha(chave);
      throw new Erro(401, restam > 0 ? "E-mail ou senha incorretos." : "Acesso bloqueado por 15 minutos.");
    }
    await limparFalhas(chave);
    const cookie = await criarSessao("coord", c.id, req);
    return { corpo: { ok: true }, cookie };
  });

  rota("GET", "/coord/eu", "coord", async ({ sessao }) => ({ nome: sessao.nome, email: sessao.email, hoje: hojeSP() }));

  rota("POST", "/coord/senha", "coord", async ({ body, sessao }) => {
    const c = await um("SELECT senha_hash FROM coordenadores WHERE id=$1", [sessao.id]);
    if (!conferirHash(String(body.atual || ""), c.senha_hash)) throw new Erro(400, "Senha atual incorreta.");
    if (String(body.nova || "").length < 8) throw new Erro(400, "A nova senha precisa ter pelo menos 8 caracteres.");
    await q("UPDATE coordenadores SET senha_hash=$1 WHERE id=$2", [gerarHash(body.nova), sessao.id]);
    return { ok: true, mensagem: "Senha alterada." };
  });

  // ---------- semana e plantões ----------
  rota("GET", "/coord/semana", "coord", async ({ url }) => {
    const cfg = await config();
    const ini = segundaValida(url.searchParams.get("ini") || hojeSP());
    const fim = addDias(ini, 6);
    const linhas = await q(`${SELECT_PLANTAO} WHERE p.data BETWEEN $1 AND $2 ORDER BY p.inicio, f.apelido`, [ini, fim]);
    const plantoes = [];
    for (const p of linhas) {
      const s = saida(p);
      if (p.status === "rascunho" && p.cuidadora_id) {
        const av = (await avaliar(cx, [p.cuidadora_id], p, cfg.descansoMin))[p.cuidadora_id];
        s.conflito = av.bloqueio || av.avisos.find((a) => a.startsWith("Informou")) || null;
      }
      plantoes.push(s);
    }
    const indisp = await q(
      `SELECT to_char(i.data,'YYYY-MM-DD') AS data, i.turno, i.em, c.nome FROM indisponibilidades i JOIN cuidadoras c ON c.id=i.cuidadora_id
        WHERE i.data BETWEEN $1 AND $2 AND c.ativa ORDER BY i.data, c.nome`,
      [ini, fim]
    );
    const familias = await q("SELECT id, apelido, bairro FROM familias WHERE ativa ORDER BY apelido");
    return {
      ini, fim, hoje: hojeSP(), plantoes, indisp, familias,
      prazoIndisp: addDias(ini, -7), envio: addDias(ini, -3),
      fechado: await periodoFechado(cx, ini),
    };
  });

  rota("GET", "/coord/plantoes/:id", "coord", async ({ params }) => {
    const cfg = await config();
    const p = await um(`${SELECT_PLANTAO} WHERE p.id=$1`, [params.id]);
    if (!p) throw new Erro(404, "Plantão não encontrado.");
    const historico = await q("SELECT em, autor_nome, texto FROM eventos WHERE plantao_id=$1 ORDER BY em DESC, id DESC", [p.id]);
    const hab = await q(
      `SELECT c.id, c.nome FROM habilitacoes h JOIN cuidadoras c ON c.id=h.cuidadora_id WHERE h.familia_id=$1 AND c.ativa ORDER BY c.nome`,
      [p.familia_id]
    );
    const av = await avaliar(cx, hab.map((h) => h.id), p, cfg.descansoMin);
    const candidatos = hab
      .map((h) => ({ id: h.id, nome: h.nome, bloqueio: av[h.id]?.bloqueio || null, avisos: av[h.id]?.avisos || [] }))
      .sort((a, b) => !!a.bloqueio - !!b.bloqueio || a.avisos.length - b.avisos.length || a.nome.localeCompare(b.nome));
    return { plantao: saida(p), historico, candidatos };
  });

  rota("POST", "/coord/plantoes", "coord", async ({ body, sessao }) => {
    const familiaId = inteiro(body.familiaId, 1, 1e9, "Família");
    if (!dataValida(body.data)) throw new Erro(400, "Data inválida.");
    const hora = inteiro(body.hora, 0, 23, "Horário");
    const duracao = inteiro(body.duracao, 1, 24, "Duração");
    const repetir = inteiro(body.repetirDias ?? 1, 1, 31, "Repetição");
    const valor = body.valor === "" || body.valor == null ? null : Number(body.valor);
    if (valor != null && (!(valor >= 0) || valor > 100000)) throw new Erro(400, "Valor inválido.");
    const f = await um("SELECT id FROM familias WHERE id=$1 AND ativa", [familiaId]);
    if (!f) throw new Erro(400, "Família inválida.");
    const criados = await transacao(async (tx) => {
      const ids = [];
      for (let i = 0; i < repetir; i++) {
        const data = addDias(body.data, i);
        if (await periodoFechado(tx, data)) throw new Erro(409, `O período que inclui ${dataBR(data)} está fechado.`);
        const r = await tx.um(
          `INSERT INTO plantoes (familia_id, data, hora, duracao, inicio, fim, valor) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [familiaId, data, hora, duracao, inicioDe(data, hora), fimDe(data, hora, duracao), valor]
        );
        await evento(tx, r.id, autorDe(sessao), "criacao", "Plantão criado.");
        ids.push(r.id);
      }
      return ids;
    });
    return { ok: true, ids: criados, mensagem: criados.length > 1 ? `${criados.length} plantões criados como rascunho.` : "Plantão criado como rascunho." };
  });

  rota("POST", "/coord/plantoes/:id/sugerir", "coord", async ({ params, body, sessao }) => {
    const cfg = await config();
    const cid = body.cuidadoraId ? inteiro(body.cuidadoraId, 1, 1e9, "Cuidadora") : null;
    const nome = await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      if (p.status !== "rascunho") throw new Erro(409, "Só é possível sugerir em plantões em rascunho.");
      if (!cid) {
        await tx.q("UPDATE plantoes SET cuidadora_id=NULL, atualizado_em=NOW() WHERE id=$1", [p.id]);
        await evento(tx, p.id, autorDe(sessao), "sugestao", "Sugestão de cuidadora removida.");
        return null;
      }
      if (!(await habilitada(tx, cid, p.familia_id))) throw new Erro(400, "Cuidadora não habilitada nesta família.");
      const av = (await avaliar(tx, [cid], p, cfg.descansoMin))[cid];
      if (av.bloqueio) throw new Erro(409, av.bloqueio);
      const c = await tx.um("SELECT nome FROM cuidadoras WHERE id=$1", [cid]);
      await tx.q("UPDATE plantoes SET cuidadora_id=$1, atualizado_em=NOW() WHERE id=$2", [cid, p.id]);
      await evento(tx, p.id, autorDe(sessao), "sugestao", `Sugerido para ${c.nome} na distribuição da semana.`);
      return c.nome;
    });
    return { ok: true, mensagem: nome ? `Sugestão registrada. O convite vai para ${nome} no envio da distribuição.` : "Sugestão removida." };
  });

  rota("POST", "/coord/plantoes/:id/convidar", "coord", async ({ params, body, sessao }) => {
    const cfg = await config();
    const cid = inteiro(body.cuidadoraId, 1, 1e9, "Cuidadora");
    const r = await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      exigirFuturo(p);
      if (!ESTADOS_OFERTAVEIS.includes(p.status)) throw new Erro(409, "Este plantão não pode receber convite agora.");
      if (!(await habilitada(tx, cid, p.familia_id))) throw new Erro(400, "Cuidadora não habilitada nesta família.");
      const av = (await avaliar(tx, [cid], p, cfg.descansoMin))[cid];
      if (av.bloqueio) throw new Erro(409, av.bloqueio);
      const c = await tx.um("SELECT nome FROM cuidadoras WHERE id=$1", [cid]);
      const prazo = prazoPadrao(cfg, p.inicio);
      await tx.q("UPDATE plantoes SET status='convite', cuidadora_id=$1, prazo=$2, atualizado_em=NOW() WHERE id=$3", [cid, prazo, p.id]);
      await evento(tx, p.id, autorDe(sessao), "convite", `Convite direto enviado a ${c.nome}.`);
      return { p, nome: c.nome };
    });
    await avisar([cid], "Novo convite de plantão", `${desc(r.p)}. Toque para responder.`);
    return { ok: true, mensagem: `Convite enviado a ${r.nome}.` };
  });

  rota("POST", "/coord/plantoes/:id/abrir", "coord", async ({ params, sessao }) => {
    const cfg = await config();
    const r = await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      exigirFuturo(p);
      if (!ESTADOS_OFERTAVEIS.includes(p.status)) throw new Erro(409, "Este plantão não pode ser ofertado agora.");
      await tx.q("UPDATE plantoes SET status='aberta', cuidadora_id=NULL, prazo=$1, atualizado_em=NOW() WHERE id=$2", [prazoPadrao(cfg, p.inicio), p.id]);
      await tx.q("DELETE FROM ofertas_dispensadas WHERE plantao_id=$1", [p.id]);
      await evento(tx, p.id, autorDe(sessao), "oferta", "Oferta aberta às cuidadoras habilitadas.");
      const hab = await tx.q("SELECT c.id FROM habilitacoes h JOIN cuidadoras c ON c.id=h.cuidadora_id WHERE h.familia_id=$1 AND c.ativa", [p.familia_id]);
      const av = await avaliar(tx, hab.map((h) => h.id), p, cfg.descansoMin);
      return { p, alvos: hab.map((h) => h.id).filter((id) => !av[id]?.bloqueio) };
    });
    await avisar(r.alvos, "Plantão disponível", `${desc(r.p)}. O primeiro aceite preenche o plantão.`);
    return { ok: true, mensagem: `Oferta aberta para ${r.alvos.length} cuidadoras habilitadas.` };
  });

  rota("POST", "/coord/plantoes/:id/alterar", "coord", async ({ params, body, sessao }) => {
    const r = await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      exigirFuturo(p);
      if (["cancelado", "realizado", "naorealizado"].includes(p.status)) throw new Erro(409, "Este plantão não pode mais ser alterado.");
      const data = body.data ? body.data : p.data;
      if (!dataValida(data)) throw new Erro(400, "Data inválida.");
      const hora = inteiro(body.hora ?? p.hora, 0, 23, "Horário");
      const duracao = inteiro(body.duracao ?? p.duracao, 1, 24, "Duração");
      const valor = body.valor === undefined ? p.valor : body.valor === "" || body.valor == null ? null : Number(body.valor);
      if (valor != null && (!(Number(valor) >= 0) || Number(valor) > 100000)) throw new Erro(400, "Valor inválido.");
      const mudouHorario = data !== p.data || hora !== p.hora || duracao !== p.duracao;
      const mudouValor = String(valor ?? "") !== String(p.valor ?? "");
      if (!mudouHorario && !mudouValor) return { p, nada: true };
      if (await periodoFechado(tx, data)) throw new Erro(409, "O período de destino está fechado.");
      const antes = `${dataBR(p.data)}, ${faixa(p.hora, p.duracao)} (${p.duracao} horas)${p.valor != null ? `, R$ ${Number(p.valor).toFixed(2).replace(".", ",")}` : ""}`;
      const depois = `${dataBR(data)}, ${faixa(hora, duracao)} (${duracao} horas)${valor != null ? `, R$ ${Number(valor).toFixed(2).replace(".", ",")}` : ""}`;
      const invalidar = p.status === "aceito" && (mudouHorario || mudouValor);
      await tx.q(
        `UPDATE plantoes SET data=$1, hora=$2, duracao=$3, inicio=$4, fim=$5, valor=$6, versao=versao+1,
            status = CASE WHEN $7 THEN 'novoaceite' ELSE status END, lembrete_enviado=FALSE, atualizado_em=NOW() WHERE id=$8`,
        [data, hora, duracao, inicioDe(data, hora), fimDe(data, hora, duracao), valor, invalidar, p.id]
      );
      await evento(tx, p.id, autorDe(sessao), "alteracao",
        `Alterado de ${antes} para ${depois}. Versão ${p.versao + 1}.${invalidar ? " Aceite anterior invalidado." : ""}`, { antes, depois });
      return { p, invalidar, depois };
    });
    if (r.nada) return { ok: true, mensagem: "Nenhuma alteração." };
    if (r.invalidar) await avisar([r.p.cuidadora_id], "Plantão alterado", `${r.p.familia}: agora ${r.depois}. Confira e confirme a nova versão.`);
    else if (["convite", "novoaceite"].includes(r.p.status) && r.p.cuidadora_id) await avisar([r.p.cuidadora_id], "Convite atualizado", `${r.p.familia}: agora ${r.depois}.`);
    return { ok: true, mensagem: r.invalidar ? `Alteração salva. ${r.p.cuidadora_nome} precisa aceitar a nova versão.` : "Alteração salva." };
  });

  rota("POST", "/coord/plantoes/:id/cancelar", "coord", async ({ params, body, sessao }) => {
    const motivo = texto(body.motivo, "o motivo", { obrigatorio: false, max: 200 });
    const p = await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      if (["cancelado", "realizado", "naorealizado"].includes(p.status)) throw new Erro(409, "Este plantão não pode ser cancelado.");
      if (p.fechado) throw new Erro(409, "O período está fechado.");
      await tx.q("UPDATE plantoes SET status='cancelado', motivo=$1, atualizado_em=NOW() WHERE id=$2", [motivo || null, p.id]);
      await evento(tx, p.id, autorDe(sessao), "cancelamento", `Plantão cancelado.${motivo ? " Motivo: " + motivo + "." : ""}`);
      return p;
    });
    if (p.cuidadora_id && ["aceito", "convite", "novoaceite"].includes(p.status) && new Date(p.inicio) > new Date())
      await avisar([p.cuidadora_id], "Plantão cancelado", `${desc(p)} foi cancelado pela Coordenação.`);
    return { ok: true, mensagem: "Plantão cancelado. Ele continua no histórico." };
  });

  // ---------- conferência ----------
  rota("POST", "/coord/plantoes/:id/conferir", "coord", async ({ params, body, sessao }) => {
    const realizado = !!body.realizado;
    const motivo = realizado ? null : texto(body.motivo, "o motivo", { max: 200 });
    await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      if (p.fechado) throw new Erro(409, "Período fechado. Registre um ajuste.");
      if (new Date(p.fim) > new Date()) throw new Erro(409, "O plantão ainda não terminou.");
      if (!["aceito", "realizado", "naorealizado"].includes(p.status) || !p.cuidadora_id) throw new Erro(409, "Este plantão não está em conferência.");
      await tx.q("UPDATE plantoes SET status=$1, motivo=$2, atualizado_em=NOW() WHERE id=$3", [realizado ? "realizado" : "naorealizado", motivo, p.id]);
      await evento(tx, p.id, autorDe(sessao), "conferencia", realizado ? "Conferido pela Coordenação: plantão realizado." : `Conferido pela Coordenação: não realizado. Motivo: ${motivo}.`);
    });
    return { ok: true, mensagem: realizado ? "Plantão confirmado como realizado." : "Registrado como não realizado." };
  });

  rota("POST", "/coord/conferencia/lote", "coord", async ({ body, sessao }) => {
    const ini = segundaValida(body.ini), fim = addDias(ini, 6);
    const n = await transacao(async (tx) => {
      if (await periodoFechado(tx, ini)) throw new Erro(409, "O período está fechado.");
      const alvos = await tx.q("SELECT id FROM plantoes WHERE data BETWEEN $1 AND $2 AND status='aceito' AND fim <= NOW() AND cuidadora_id IS NOT NULL FOR UPDATE", [ini, fim]);
      for (const a of alvos) {
        await tx.q("UPDATE plantoes SET status='realizado', atualizado_em=NOW() WHERE id=$1", [a.id]);
        await evento(tx, a.id, autorDe(sessao), "conferencia", "Conferido pela Coordenação (em lote): plantão realizado.");
      }
      return alvos.length;
    });
    return { ok: true, mensagem: n === 1 ? "1 plantão confirmado como realizado." : `${n} plantões confirmados como realizados.` };
  });

  rota("GET", "/coord/conferencia", "coord", async ({ url }) => {
    const ini = segundaValida(url.searchParams.get("ini") || addDias(hojeSP(), -7)), fim = addDias(ini, 6);
    const linhas = await q(`${SELECT_PLANTAO} WHERE p.data BETWEEN $1 AND $2 AND p.status NOT IN ('rascunho','cancelado') ORDER BY p.inicio`, [ini, fim]);
    const itens = linhas.map((p) => saida(p));
    const fechamento = await um("SELECT fechado_em, fechado_por FROM periodos_fechados WHERE inicio=$1", [ini]);
    const futuros = itens.filter((p) => new Date(p.fim) > new Date()).length;
    const pendentes = itens.filter((p) => p.status === "conferencia").length;
    return { ini, fim, itens, fechamento, futuros, pendentes };
  });

  rota("POST", "/coord/periodos/fechar", "coord", async ({ body, sessao }) => {
    const ini = segundaValida(body.ini), fim = addDias(ini, 6);
    await transacao(async (tx) => {
      if (await periodoFechado(tx, ini)) throw new Erro(409, "Este período já está fechado.");
      const bloqueio = await tx.um(
        `SELECT COUNT(*) FILTER (WHERE fim > NOW() AND status NOT IN ('cancelado'))::int AS futuros,
                COUNT(*) FILTER (WHERE status='aceito' AND fim <= NOW())::int AS pendentes
           FROM plantoes WHERE data BETWEEN $1 AND $2`,
        [ini, fim]
      );
      if (bloqueio.futuros) throw new Erro(409, "O período ainda tem plantões por acontecer.");
      if (bloqueio.pendentes) throw new Erro(409, "Confira todos os plantões antes de fechar.");
      await tx.q("INSERT INTO periodos_fechados (inicio, fim, fechado_por) VALUES ($1,$2,$3)", [ini, fim, sessao.nome]);
      const ids = await tx.q("SELECT id FROM plantoes WHERE data BETWEEN $1 AND $2", [ini, fim]);
      for (const r of ids) await evento(tx, r.id, autorDe(sessao), "fechamento", `Período ${dataBR(ini)} a ${dataBR(fim)} fechado.`);
    });
    return { ok: true, mensagem: `Período ${dataBR(ini)} a ${dataBR(fim)} fechado. Os plantões estão travados.` };
  });

  rota("POST", "/coord/plantoes/:id/ajuste", "coord", async ({ params, body, sessao }) => {
    const novo = body.status;
    if (!["realizado", "naorealizado"].includes(novo)) throw new Erro(400, "Situação inválida.");
    const motivo = texto(body.motivo, "o motivo do ajuste", { max: 200 });
    await transacao(async (tx) => {
      const p = await carregar(tx, params.id);
      if (!p.fechado) throw new Erro(409, "O período não está fechado. Use a conferência normal.");
      if (!["realizado", "naorealizado"].includes(p.status)) throw new Erro(409, "Este plantão não admite ajuste.");
      await tx.q("UPDATE plantoes SET status=$1, motivo=$2, atualizado_em=NOW() WHERE id=$3", [novo, novo === "naorealizado" ? "Ajuste: " + motivo : null, p.id]);
      await evento(tx, p.id, autorDe(sessao), "ajuste", `Ajuste após fechamento: de ${p.status === "realizado" ? "Realizado" : "Não realizado"} para ${novo === "realizado" ? "Realizado" : "Não realizado"}. Motivo: ${motivo}.`);
    });
    return { ok: true, mensagem: "Ajuste registrado no histórico." };
  });

  // ---------- distribuição semanal ----------
  rota("POST", "/coord/distribuicao/enviar", "coord", async ({ body, sessao }) => {
    const cfg = await config();
    const ini = segundaValida(body.ini), fim = addDias(ini, 6);
    const r = await transacao(async (tx) => {
      const rasc = await tx.q(`${SELECT_PLANTAO} WHERE p.data BETWEEN $1 AND $2 AND p.status='rascunho' AND p.cuidadora_id IS NOT NULL AND p.inicio > NOW() FOR UPDATE OF p`, [ini, fim]);
      const enviados = [], retidos = [];
      for (const p of rasc) {
        const av = (await avaliar(tx, [p.cuidadora_id], p, cfg.descansoMin))[p.cuidadora_id];
        if (av.bloqueio || av.avisos.some((a) => a.startsWith("Informou"))) { retidos.push(p); continue; }
        await tx.q("UPDATE plantoes SET status='convite', prazo=$1, atualizado_em=NOW() WHERE id=$2", [prazoPadrao(cfg, p.inicio), p.id]);
        await evento(tx, p.id, autorDe(sessao), "convite", `Convite direto enviado a ${p.cuidadora_nome} (distribuição da semana).`);
        enviados.push(p);
      }
      return { enviados, retidos };
    });
    const porCuid = {};
    r.enviados.forEach((p) => (porCuid[p.cuidadora_id] = (porCuid[p.cuidadora_id] || 0) + 1));
    for (const [cid, n] of Object.entries(porCuid))
      await avisar([Number(cid)], "Convites da semana", `Você recebeu ${n} ${n > 1 ? "convites" : "convite"} de plantão para ${dataBR(ini)} a ${dataBR(fim)}. Toque para responder.`);
    const pessoas = Object.keys(porCuid).length;
    return { ok: true, mensagem: `${r.enviados.length} convites enviados para ${pessoas} ${pessoas === 1 ? "cuidadora" : "cuidadoras"}.${r.retidos.length ? (r.retidos.length === 1 ? " 1 ficou em rascunho por conflito." : ` ${r.retidos.length} ficaram em rascunho por conflito.`) : ""}` };
  });

  rota("POST", "/coord/distribuicao/copiar", "coord", async ({ body, sessao }) => {
    const de = segundaValida(body.de), para = segundaValida(body.para);
    if (de === para) throw new Erro(400, "Escolha semanas diferentes.");
    const dias = Math.round((new Date(para) - new Date(de)) / 864e5);
    const n = await transacao(async (tx) => {
      if (await periodoFechado(tx, para)) throw new Erro(409, "A semana de destino está fechada.");
      const origem = await tx.q(`${SELECT_PLANTAO} WHERE p.data BETWEEN $1 AND $2 AND p.status <> 'cancelado' AND f.ativa`, [de, addDias(de, 6)]);
      let criados = 0;
      for (const p of origem) {
        const data = addDias(p.data, dias);
        const existe = await tx.um("SELECT 1 FROM plantoes WHERE familia_id=$1 AND data=$2 AND hora=$3 AND status <> 'cancelado'", [p.familia_id, data, p.hora]);
        if (existe) continue;
        let sug = null;
        if (p.cuidadora_id && ["aceito", "convite", "novoaceite", "realizado"].includes(p.status) && (await habilitada(tx, p.cuidadora_id, p.familia_id))) sug = p.cuidadora_id;
        const novo = await tx.um(
          "INSERT INTO plantoes (familia_id, data, hora, duracao, inicio, fim, valor, cuidadora_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [p.familia_id, data, p.hora, p.duracao, inicioDe(data, p.hora), fimDe(data, p.hora, p.duracao), p.valor, sug]
        );
        await evento(tx, novo.id, autorDe(sessao), "criacao", `Plantão criado a partir da semana de ${dataBR(de)}${sug ? `, com sugestão para ${p.cuidadora_nome}` : ""}.`);
        criados++;
      }
      return criados;
    });
    return { ok: true, mensagem: n ? `${n} plantões copiados como rascunho. Revise as sugestões antes de enviar.` : "A semana já contém todos os plantões do padrão." };
  });

  // ---------- extratos ----------
  rota("GET", "/coord/extrato", "coord", async ({ url, sessao }) => {
    const tipo = url.searchParams.get("tipo");
    if (!["cuid", "fam"].includes(tipo)) throw new Erro(400, "Tipo inválido.");
    const id = inteiro(url.searchParams.get("id"), 1, 1e9, "Identificador");
    const ini = url.searchParams.get("ini"), fim = url.searchParams.get("fim");
    if (!dataValida(ini) || !dataValida(fim) || fim < ini) throw new Erro(400, "Período inválido.");
    return montarExtrato({ tipo, id, ini, fim, comValor: true, emissor: `Coordenação (${sessao.nome})` });
  });

  // ---------- cadastros ----------
  rota("GET", "/coord/cadastros", "coord", async () => {
    const cuidadoras = await q("SELECT id, nome, celular, ativa, pin_provisorio FROM cuidadoras ORDER BY ativa DESC, nome");
    const familias = await q("SELECT id, apelido, bairro, ativa FROM familias ORDER BY ativa DESC, apelido");
    const hab = await q("SELECT familia_id, cuidadora_id FROM habilitacoes");
    return {
      cuidadoras: cuidadoras.map((c) => ({ ...c, celular: formatarCelular(c.celular), familias: hab.filter((h) => h.cuidadora_id === c.id).map((h) => h.familia_id) })),
      familias: familias.map((f) => ({ ...f, cuidadoras: hab.filter((h) => h.familia_id === f.id).map((h) => h.cuidadora_id) })),
    };
  });

  const lerCuidadora = (body) => {
    const nome = texto(body.nome, "o nome", { max: 80 });
    const cel = soDigitos(body.celular);
    if (cel.length < 10 || cel.length > 11) throw new Erro(400, "Informe o celular com DDD.");
    const familias = Array.isArray(body.familias) ? body.familias.map((f) => inteiro(f, 1, 1e9, "Família")) : [];
    return { nome, cel, familias };
  };

  rota("POST", "/coord/cuidadoras", "coord", async ({ body }) => {
    const { nome, cel, familias } = lerCuidadora(body);
    const pin = pinProvisorio();
    await transacao(async (tx) => {
      if (await tx.um("SELECT 1 FROM cuidadoras WHERE celular=$1", [cel])) throw new Erro(409, "Já existe uma cuidadora com este celular.");
      const c = await tx.um("INSERT INTO cuidadoras (nome, celular, pin_hash) VALUES ($1,$2,$3) RETURNING id", [nome, cel, gerarHash(pin)]);
      for (const f of familias) await tx.q("INSERT INTO habilitacoes (familia_id, cuidadora_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [f, c.id]);
    });
    return { ok: true, pin, nome, mensagem: `${nome} cadastrada.` };
  });

  rota("POST", "/coord/cuidadoras/:id", "coord", async ({ params, body, sessao }) => {
    const id = inteiro(params.id, 1, 1e9, "Cuidadora");
    const { nome, cel, familias } = lerCuidadora(body);
    const n = await transacao(async (tx) => {
      if (await tx.um("SELECT 1 FROM cuidadoras WHERE celular=$1 AND id<>$2", [cel, id])) throw new Erro(409, "Já existe uma cuidadora com este celular.");
      await tx.q("UPDATE cuidadoras SET nome=$1, celular=$2 WHERE id=$3", [nome, cel, id]);
      const atuais = (await tx.q("SELECT familia_id FROM habilitacoes WHERE cuidadora_id=$1", [id])).map((r) => r.familia_id);
      const removidas = atuais.filter((f) => !familias.includes(f));
      const revogados = removidas.length ? await revogar(tx, id, removidas, "habilitação retirada", autorDe(sessao)) : 0;
      await tx.q("DELETE FROM habilitacoes WHERE cuidadora_id=$1", [id]);
      for (const f of familias) await tx.q("INSERT INTO habilitacoes (familia_id, cuidadora_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [f, id]);
      return revogados;
    });
    return { ok: true, mensagem: n ? `Cadastro salvo. ${n === 1 ? "1 plantão voltou" : n + " plantões voltaram"} para a Coordenação.` : "Cadastro salvo." };
  });

  rota("POST", "/coord/cuidadoras/:id/pin", "coord", async ({ params }) => {
    const id = inteiro(params.id, 1, 1e9, "Cuidadora");
    const pin = pinProvisorio();
    const c = await um("UPDATE cuidadoras SET pin_hash=$1, pin_provisorio=TRUE WHERE id=$2 RETURNING nome", [gerarHash(pin), id]);
    if (!c) throw new Erro(404, "Cuidadora não encontrada.");
    await encerrarSessoesDe("cuid", id);
    await q("DELETE FROM tentativas WHERE chave = (SELECT 'cel:' || celular FROM cuidadoras WHERE id=$1)", [id]);
    return { ok: true, pin, nome: c.nome, mensagem: "PIN redefinido." };
  });

  rota("POST", "/coord/cuidadoras/:id/ativa", "coord", async ({ params, body, sessao }) => {
    const id = inteiro(params.id, 1, 1e9, "Cuidadora");
    const ativa = !!body.ativa;
    let n = 0, pin = null;
    await transacao(async (tx) => {
      if (!ativa) {
        const fams = (await tx.q("SELECT id FROM familias")).map((f) => f.id);
        n = await revogar(tx, id, fams, "cuidadora inativada", autorDe(sessao));
        await tx.q("UPDATE cuidadoras SET ativa=FALSE WHERE id=$1", [id]);
      } else {
        pin = pinProvisorio();
        await tx.q("UPDATE cuidadoras SET ativa=TRUE, pin_hash=$1, pin_provisorio=TRUE WHERE id=$2", [gerarHash(pin), id]);
      }
    });
    if (!ativa) await encerrarSessoesDe("cuid", id);
    return { ok: true, pin, mensagem: ativa ? "Cuidadora reativada." : `Cuidadora inativada. Acesso revogado${n ? `; ${n === 1 ? "1 plantão voltou" : n + " plantões voltaram"} para a Coordenação` : ""}.` };
  });

  // Exclusão definitiva só para cadastros sem nenhum registro no histórico (ex.: cadastro feito por engano).
  // Quem já participou de plantões é apenas inativado, para preservar a trilha de auditoria.
  rota("POST", "/coord/cuidadoras/:id/excluir", "coord", async ({ params }) => {
    const id = inteiro(params.id, 1, 1e9, "Cuidadora");
    const nome = await transacao(async (tx) => {
      const c = await tx.um("SELECT nome, celular FROM cuidadoras WHERE id=$1 FOR UPDATE", [id]);
      if (!c) throw new Erro(404, "Cuidadora não encontrada.");
      const uso = await tx.um(
        `SELECT (SELECT COUNT(*) FROM plantoes WHERE cuidadora_id=$1)
              + (SELECT COUNT(*) FROM imprevistos WHERE cuidadora_id=$1)
              + (SELECT COUNT(*) FROM eventos WHERE autor_tipo='cuid' AND autor_id=$1) AS n`,
        [id]
      );
      if (Number(uso.n) > 0) throw new Erro(409, `${c.nome} já tem plantões no histórico e não pode ser excluída. Use Inativar: o acesso é revogado e o histórico fica preservado.`);
      await tx.q("DELETE FROM sessoes WHERE tipo='cuid' AND usuario_id=$1", [id]);
      await tx.q("DELETE FROM tentativas WHERE chave=$1", ["cel:" + c.celular]);
      await tx.q("DELETE FROM cuidadoras WHERE id=$1", [id]);
      return c.nome;
    });
    return { ok: true, mensagem: `${nome} excluída.` };
  });

  rota("POST", "/coord/familias/:id/excluir", "coord", async ({ params }) => {
    const id = inteiro(params.id, 1, 1e9, "Família");
    const nome = await transacao(async (tx) => {
      const f = await tx.um("SELECT apelido FROM familias WHERE id=$1 FOR UPDATE", [id]);
      if (!f) throw new Erro(404, "Família não encontrada.");
      const uso = await tx.um("SELECT COUNT(*)::int AS n FROM plantoes WHERE familia_id=$1", [id]);
      if (uso.n > 0) throw new Erro(409, `${f.apelido} já tem plantões registrados e não pode ser excluída. Use Inativar família: o histórico fica preservado.`);
      await tx.q("DELETE FROM familias WHERE id=$1", [id]);
      return f.apelido;
    });
    return { ok: true, mensagem: `${nome} excluída.` };
  });

  const lerFamilia = (body) => ({
    apelido: texto(body.apelido, "a identificação da família", { max: 60 }),
    bairro: texto(body.bairro, "o bairro", { obrigatorio: false, max: 60 }),
    cuidadoras: Array.isArray(body.cuidadoras) ? body.cuidadoras.map((c) => inteiro(c, 1, 1e9, "Cuidadora")) : [],
  });

  rota("POST", "/coord/familias", "coord", async ({ body }) => {
    const f = lerFamilia(body);
    await transacao(async (tx) => {
      const r = await tx.um("INSERT INTO familias (apelido, bairro) VALUES ($1,$2) RETURNING id", [f.apelido, f.bairro]);
      for (const c of f.cuidadoras) await tx.q("INSERT INTO habilitacoes (familia_id, cuidadora_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [r.id, c]);
    });
    return { ok: true, mensagem: `${f.apelido} cadastrada.` };
  });

  rota("POST", "/coord/familias/:id", "coord", async ({ params, body, sessao }) => {
    const id = inteiro(params.id, 1, 1e9, "Família");
    const f = lerFamilia(body);
    const n = await transacao(async (tx) => {
      await tx.q("UPDATE familias SET apelido=$1, bairro=$2 WHERE id=$3", [f.apelido, f.bairro, id]);
      const atuais = (await tx.q("SELECT cuidadora_id FROM habilitacoes WHERE familia_id=$1", [id])).map((r) => r.cuidadora_id);
      let revogados = 0;
      for (const c of atuais.filter((c) => !f.cuidadoras.includes(c))) revogados += await revogar(tx, c, [id], "habilitação retirada", autorDe(sessao));
      await tx.q("DELETE FROM habilitacoes WHERE familia_id=$1", [id]);
      for (const c of f.cuidadoras) await tx.q("INSERT INTO habilitacoes (familia_id, cuidadora_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, c]);
      return revogados;
    });
    return { ok: true, mensagem: n ? `Cadastro salvo. ${n === 1 ? "1 plantão voltou" : n + " plantões voltaram"} para a Coordenação.` : "Cadastro salvo." };
  });

  rota("POST", "/coord/familias/:id/ativa", "coord", async ({ params, body }) => {
    const id = inteiro(params.id, 1, 1e9, "Família");
    if (!body.ativa) {
      const r = await um("SELECT COUNT(*)::int AS n FROM plantoes WHERE familia_id=$1 AND inicio > NOW() AND status NOT IN ('cancelado')", [id]);
      if (r.n) throw new Erro(409, "Esta família tem plantões programados. Cancele-os antes de inativar.");
    }
    await q("UPDATE familias SET ativa=$1 WHERE id=$2", [!!body.ativa, id]);
    return { ok: true, mensagem: body.ativa ? "Família reativada." : "Família inativada." };
  });

  // ---------- ajustes ----------
  rota("GET", "/coord/config", "coord", async () => {
    const cfg = await config();
    const coordenadores = await q("SELECT id, nome, email, ativo FROM coordenadores ORDER BY nome");
    return { ...cfg, coordenadores };
  });

  rota("POST", "/coord/config", "coord", async ({ body }) => {
    const descanso = inteiro(body.descansoMin, 0, 48, "Descanso mínimo");
    const prazo = inteiro(body.prazoPadraoH, 2, 240, "Prazo de resposta");
    await q("UPDATE config SET valor=$1 WHERE chave='descanso_min_h'", [String(descanso)]);
    await q("UPDATE config SET valor=$1 WHERE chave='prazo_padrao_h'", [String(prazo)]);
    await q("UPDATE config SET valor=$1 WHERE chave='mostrar_valor'", [body.mostrarValor ? "sim" : "nao"]);
    return { ok: true, mensagem: "Ajustes salvos." };
  });

  rota("POST", "/coord/coordenadores", "coord", async ({ body }) => {
    const nome = texto(body.nome, "o nome", { max: 80 });
    const email = texto(body.email, "o e-mail", { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Erro(400, "Informe um e-mail válido.");
    if (String(body.senha || "").length < 8) throw new Erro(400, "A senha provisória precisa ter pelo menos 8 caracteres.");
    if (await um("SELECT 1 FROM coordenadores WHERE email=$1", [email])) throw new Erro(409, "Este e-mail já tem acesso.");
    await q("INSERT INTO coordenadores (nome, email, senha_hash) VALUES ($1,$2,$3)", [nome, email, gerarHash(body.senha)]);
    return { ok: true, mensagem: `Acesso criado para ${nome}.` };
  });

  rota("POST", "/coord/coordenadores/:id/excluir", "coord", async ({ params, sessao }) => {
    const id = inteiro(params.id, 1, 1e9, "Coordenador");
    if (id === sessao.id) throw new Erro(400, "Você não pode excluir o próprio acesso.");
    const nome = await transacao(async (tx) => {
      const c = await tx.um("SELECT nome, email FROM coordenadores WHERE id=$1 FOR UPDATE", [id]);
      if (!c) throw new Erro(404, "Acesso não encontrado.");
      const uso = await tx.um("SELECT COUNT(*)::int AS n FROM eventos WHERE autor_tipo='coord' AND autor_id=$1", [id]);
      if (uso.n > 0) throw new Erro(409, `${c.nome} já registrou ações no histórico e não pode ser excluída. Use Desativar: o acesso deixa de funcionar e o histórico fica preservado.`);
      await tx.q("DELETE FROM sessoes WHERE tipo='coord' AND usuario_id=$1", [id]);
      await tx.q("DELETE FROM tentativas WHERE chave=$1", ["email:" + c.email]);
      await tx.q("DELETE FROM coordenadores WHERE id=$1", [id]);
      return c.nome;
    });
    return { ok: true, mensagem: `Acesso de ${nome} excluído.` };
  });

  rota("POST", "/coord/coordenadores/:id/ativo", "coord", async ({ params, body, sessao }) => {
    const id = inteiro(params.id, 1, 1e9, "Coordenador");
    if (id === sessao.id && !body.ativo) throw new Erro(400, "Você não pode desativar o próprio acesso.");
    await q("UPDATE coordenadores SET ativo=$1 WHERE id=$2", [!!body.ativo, id]);
    if (!body.ativo) await encerrarSessoesDe("coord", id);
    return { ok: true, mensagem: body.ativo ? "Acesso reativado." : "Acesso desativado." };
  });
}
