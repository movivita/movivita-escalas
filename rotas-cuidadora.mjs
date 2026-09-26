import { q, um, transacao, config, cx } from "./db.mjs";
import {
  Erro, soDigitos, hojeSP, addDias, segundaDe, dataBR, faixa, dataValida, texto,
  TEXTO_VOLUNTARIEDADE, TEXTO_COMPROMISSO,
} from "./util.mjs";
import {
  verificarBloqueio, registrarFalha, limparFalhas, criarSessao, conferirHash, gerarHash, pinFraco,
} from "./auth.mjs";
import { SELECT_PLANTAO, saida, evento, avaliar, habilitada } from "./regras.mjs";
import { chavePublica } from "./push.mjs";
import { montarExtrato } from "./extrato.mjs";

const autorDe = (s) => ({ tipo: "cuid", id: s.id, nome: s.nome });
const primeiroNome = (n) => (n || "").split(" ")[0];

export function registrar(rota) {
  rota("POST", "/cuidadora/entrar", null, async ({ body, req }) => {
    const cel = soDigitos(body.celular);
    const pin = String(body.pin || "");
    if (cel.length < 10) throw new Erro(400, "Informe o celular com DDD.");
    const chave = "cel:" + cel;
    await verificarBloqueio(chave);
    const c = await um("SELECT id, pin_hash, ativa, pin_provisorio FROM cuidadoras WHERE celular=$1", [cel]);
    if (!c || !conferirHash(pin, c.pin_hash)) {
      const restam = await registrarFalha(chave);
      throw new Erro(401, restam > 0 ? `Celular ou PIN incorretos. Restam ${restam} tentativas.` : "Acesso bloqueado por 15 minutos. Fale com a Coordenação se precisar.");
    }
    if (!c.ativa) throw new Erro(403, "Seu acesso está desativado. Fale com a Coordenação.");
    await limparFalhas(chave);
    const cookie = await criarSessao("cuid", c.id, req);
    return { corpo: { provisorio: c.pin_provisorio }, cookie };
  });

  rota("POST", "/cuidadora/novo-pin", "cuid-provisorio", async ({ body, sessao }) => {
    const pin = String(body.pin || "");
    const fraco = pinFraco(pin);
    if (fraco) throw new Erro(400, fraco);
    await q("UPDATE cuidadoras SET pin_hash=$1, pin_provisorio=FALSE WHERE id=$2", [gerarHash(pin), sessao.id]);
    return { ok: true };
  });

  rota("GET", "/eu", "cuid", async ({ sessao }) => {
    const cfg = await config();
    const me = sessao.id;
    const hoje = hojeSP();

    const convitesRaw = await q(
      `${SELECT_PLANTAO}
        WHERE p.inicio > NOW() AND (
          (p.cuidadora_id = $1 AND p.status IN ('convite','novoaceite'))
          OR (p.status = 'aberta' AND EXISTS (SELECT 1 FROM habilitacoes h WHERE h.familia_id=p.familia_id AND h.cuidadora_id=$1)
              AND NOT EXISTS (SELECT 1 FROM ofertas_dispensadas o WHERE o.plantao_id=p.id AND o.cuidadora_id=$1)))
          AND f.ativa
        ORDER BY p.inicio`,
      [me]
    );
    const convites = [];
    for (const p of convitesRaw) {
      const av = (await avaliar(cx, [me], p, cfg.descansoMin))[me];
      const s = saida(p, { comValor: cfg.mostrarValor });
      s.bloqueio = av.bloqueio;
      s.avisos = av.avisos.filter((a) => a.startsWith("Intervalo"));
      if (p.status === "novoaceite") {
        const ev = await um("SELECT dados FROM eventos WHERE plantao_id=$1 AND acao='alteracao' ORDER BY em DESC LIMIT 1", [p.id]);
        s.antes = ev?.dados?.antes || null;
      }
      convites.push(s);
    }

    const agenda = (await q(`${SELECT_PLANTAO} WHERE p.cuidadora_id=$1 AND p.status='aceito' AND p.fim > NOW() ORDER BY p.inicio`, [me]))
      .map((p) => saida(p, { comValor: cfg.mostrarValor }));
    const lembretes = agenda.filter((p) => !p.emAndamento && new Date(p.inicio) - Date.now() < 36 * 3600e3);

    const fams = await q(
      `SELECT f.id, f.apelido, f.bairro FROM habilitacoes h JOIN familias f ON f.id=h.familia_id
        WHERE h.cuidadora_id=$1 AND f.ativa ORDER BY f.apelido`,
      [me]
    );
    const cobertura = await q(
      `${SELECT_PLANTAO} WHERE p.familia_id = ANY($1) AND p.data BETWEEN $2 AND $3
         AND p.status NOT IN ('rascunho','realizado','naorealizado') AND p.fim > NOW() ORDER BY p.inicio`,
      [fams.map((f) => f.id), hoje, addDias(hoje, 14)]
    );
    const familias = fams.map((f) => ({
      apelido: f.apelido,
      bairro: f.bairro,
      plantoes: cobertura.filter((p) => p.familia_id === f.id).map((p) => ({
        data: p.data, hora: p.hora, duracao: p.duracao,
        situacao: p.status === "aceito" ? "coberto" : p.status === "cancelado" ? "cancelado" : "aberto",
        quem: p.status === "aceito" ? primeiroNome(p.cuidadora_nome) : null,
      })),
    }));

    const indisp = await q("SELECT to_char(data,'YYYY-MM-DD') AS data, turno FROM indisponibilidades WHERE cuidadora_id=$1 AND data >= $2", [me, hoje]);
    const seg = segundaDe(hoje);
    const semanas = [7, 14].map((d) => {
      const ini = addDias(seg, d);
      const prazo = addDias(ini, -7);
      return { ini, fim: addDias(ini, 6), prazo, prazoPassou: prazo < hoje };
    });

    return {
      nome: sessao.nome,
      convites, agenda, lembretes, familias, indisp, semanas,
      config: {
        mostrarValor: cfg.mostrarValor,
        voluntariedade: TEXTO_VOLUNTARIEDADE[cfg.voluntariedadeVersao] || TEXTO_VOLUNTARIEDADE.v1,
        compromisso: TEXTO_COMPROMISSO,
        vapid: chavePublica(),
      },
    };
  });

  rota("POST", "/convites/:id/aceitar", "cuid", async ({ params, sessao }) => {
    const cfg = await config();
    const me = sessao.id;
    const r = await transacao(async (tx) => {
      const p = await tx.um(`${SELECT_PLANTAO} WHERE p.id=$1 FOR UPDATE OF p`, [params.id]);
      if (!p) throw new Erro(404, "Plantão não encontrado.");
      if (new Date(p.inicio) <= new Date()) throw new Erro(409, "Este plantão já começou.");
      const meu = p.cuidadora_id === me && ["convite", "novoaceite"].includes(p.status);
      const aberto = p.status === "aberta" && (await habilitada(tx, me, p.familia_id));
      if (!meu && !aberto) throw new Erro(409, "Este plantão já foi preenchido ou não está mais disponível para você.");
      const av = (await avaliar(tx, [me], p, cfg.descansoMin))[me];
      if (av.bloqueio) throw new Erro(409, `${av.bloqueio}. Fale com a Coordenação.`);
      await tx.q("UPDATE plantoes SET status='aceito', cuidadora_id=$1, atualizado_em=NOW() WHERE id=$2", [me, p.id]);
      await evento(tx, p.id, autorDe(sessao), "aceite", `Aceitou a versão ${p.versao}. Texto de voluntariedade exibido: ${cfg.voluntariedadeVersao}.`,
        { versao: p.versao, voluntariedade: cfg.voluntariedadeVersao, modo: p.status });
      return p;
    });
    return { ok: true, mensagem: "Plantão aceito e confirmado na sua agenda. Contamos com você.", plantao: r.id };
  });

  rota("POST", "/convites/:id/recusar", "cuid", async ({ params, sessao }) => {
    const me = sessao.id;
    const msg = await transacao(async (tx) => {
      const p = await tx.um(`${SELECT_PLANTAO} WHERE p.id=$1 FOR UPDATE OF p`, [params.id]);
      if (!p) throw new Erro(404, "Plantão não encontrado.");
      if (p.status === "aberta") {
        await tx.q("INSERT INTO ofertas_dispensadas (plantao_id, cuidadora_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.id, me]);
        await evento(tx, p.id, autorDe(sessao), "recusa_oferta", "Recusou a oferta aberta.");
        return "Tudo certo. Este plantão não aparece mais para você.";
      }
      if (p.cuidadora_id !== me || !["convite", "novoaceite"].includes(p.status)) throw new Erro(409, "Este convite não está mais pendente.");
      await tx.q("UPDATE plantoes SET status='aguardando', cuidadora_id=NULL, atualizado_em=NOW() WHERE id=$1", [p.id]);
      await evento(tx, p.id, autorDe(sessao), "recusa", p.status === "novoaceite" ? "Recusou a nova versão do plantão." : "Recusou o convite.");
      return "Recusa registrada. A Coordenação vai buscar outra cobertura.";
    });
    return { ok: true, mensagem: msg };
  });

  rota("POST", "/plantoes/:id/imprevisto", "cuid", async ({ params, body, sessao }) => {
    const relato = texto(body.relato, "o relato", { obrigatorio: false, max: 300 });
    await transacao(async (tx) => {
      const p = await tx.um(`${SELECT_PLANTAO} WHERE p.id=$1 FOR UPDATE OF p`, [params.id]);
      if (!p || p.cuidadora_id !== sessao.id || p.status !== "aceito") throw new Erro(409, "Este plantão não está na sua agenda.");
      const horas = Math.floor((new Date(p.inicio) - Date.now()) / 3600e3);
      if (horas < 0) throw new Erro(409, "O plantão já começou. Ligue para a Coordenação.");
      await tx.q("UPDATE plantoes SET status='aguardando', cuidadora_id=NULL, atualizado_em=NOW() WHERE id=$1", [p.id]);
      await tx.q("INSERT INTO imprevistos (plantao_id, cuidadora_id, horas_antes, relato) VALUES ($1,$2,$3,$4)", [p.id, sessao.id, horas, relato || null]);
      await evento(tx, p.id, autorDe(sessao), "imprevisto",
        `Informou imprevisto ${horas} horas antes do início e devolveu o plantão.${relato ? " Relato: " + relato + "." : ""}`, { horas, relato });
    });
    return { ok: true, mensagem: "Obrigado por avisar logo. A Coordenação já foi notificada e vai buscar outra cobertura." };
  });

  rota("POST", "/indisponibilidade", "cuid", async ({ body, sessao }) => {
    if (!dataValida(body.data)) throw new Erro(400, "Data inválida.");
    if (body.data < hojeSP()) throw new Erro(400, "Não é possível marcar datas passadas.");
    if (!["dia", "noite"].includes(body.turno)) throw new Erro(400, "Turno inválido.");
    if (body.marcar) await q("INSERT INTO indisponibilidades (cuidadora_id, data, turno) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [sessao.id, body.data, body.turno]);
    else await q("DELETE FROM indisponibilidades WHERE cuidadora_id=$1 AND data=$2 AND turno=$3", [sessao.id, body.data, body.turno]);
    return { ok: true, mensagem: body.marcar ? "Indisponibilidade registrada. A Coordenação já pode ver." : "Indisponibilidade retirada." };
  });

  rota("GET", "/eu/extrato", "cuid", async ({ url, sessao }) => {
    const ini = url.searchParams.get("ini"), fim = url.searchParams.get("fim");
    if (!dataValida(ini) || !dataValida(fim) || fim < ini) throw new Erro(400, "Período inválido.");
    const cfg = await config();
    return montarExtrato({ tipo: "cuid", id: sessao.id, ini, fim, comValor: cfg.mostrarValor, emissor: sessao.nome });
  });

  rota("POST", "/push/inscrever", "cuid", async ({ body, sessao }) => {
    const { endpoint, keys } = body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Erro(400, "Inscrição inválida.");
    await q(
      `INSERT INTO push_inscricoes (endpoint, cuidadora_id, p256dh, auth) VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET cuidadora_id=EXCLUDED.cuidadora_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`,
      [endpoint, sessao.id, keys.p256dh, keys.auth]
    );
    return { ok: true };
  });
}

export { dataBR, faixa };
