import {
  $, esc, api, dt, faixa, brl, dataHora, dataCurta, addDias, hojeSP, segundaDe, pill, toast, abrirFolha, fecharFolha, carregando,
  htmlExtrato, baixarPDF, ROTULO,
} from "/comum.js";

const app = $("#app");
const st = {
  eu: null, aba: "cobertura",
  semana: segundaDe(hojeSP()), sem: null, filtroFam: "",
  conf: addDias(segundaDe(hojeSP()), -7), confDados: null,
  cad: null, cadSeg: "cuid", busca: "",
  extTipo: "cuid",
};
let ocupado = false;

// ---------- entrada ----------
async function iniciar() {
  app.innerHTML = carregando();
  try {
    st.eu = await api("/coord/eu");
    await irPara(st.aba);
  } catch (e) {
    if (e.status !== 401) { app.innerHTML = `<div class="main"><p class="err">${esc(e.message)}</p></div>`; return; }
    const s = await api("/coord/setup").catch(() => ({ precisaSetup: false }));
    s.precisaSetup ? telaSetup() : telaEntrar();
  }
}

function telaEntrar(erro = "") {
  app.innerHTML = `<div class="main" style="justify-content:center;gap:18px;max-width:420px;margin:0 auto;width:100%">
    <div style="text-align:center"><img src="/logo.png" alt="Movivita" style="width:88px;height:88px;object-fit:contain"></div>
    <div style="text-align:center"><h1>Coordenação</h1><p class="sub">Escala Movivita</p></div>
    <form id="fEntrar" class="card" style="gap:14px" novalidate>
      <div class="field"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username"></div>
      <div class="field"><label for="senha">Senha</label><input id="senha" type="password" autocomplete="current-password"></div>
      ${erro ? `<p class="err">${esc(erro)}</p>` : ""}
      <button class="btn prim full" type="submit">Entrar</button>
    </form></div>`;
  $("#fEntrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/coord/entrar", { metodo: "POST", dados: { email: $("#email").value, senha: $("#senha").value } }); iniciar(); }
    catch (err) { telaEntrar(err.message); }
  });
}

function telaSetup(erro = "") {
  app.innerHTML = `<div class="main" style="gap:18px;max-width:460px;margin:0 auto;width:100%">
    <div><h1>Primeiro acesso</h1><p class="sub">Crie o acesso da primeira pessoa da Coordenação. Depois, ela cadastra as demais em Ajustes.</p></div>
    <form id="fSetup" class="card" style="gap:14px" novalidate>
      <div class="field"><label for="token">Código de instalação (SETUP_TOKEN)</label><input id="token" autocomplete="off"></div>
      <div class="field"><label for="nome">Nome</label><input id="nome" autocomplete="name"></div>
      <div class="field"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username"></div>
      <div class="field"><label for="senha">Senha (mínimo de 8 caracteres)</label><input id="senha" type="password" autocomplete="new-password"></div>
      ${erro ? `<p class="err">${esc(erro)}</p>` : ""}
      <button class="btn prim full" type="submit">Criar acesso</button>
    </form></div>`;
  $("#fSetup").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/coord/setup", { metodo: "POST", dados: { token: $("#token").value, nome: $("#nome").value, email: $("#email").value, senha: $("#senha").value } });
      iniciar();
    } catch (err) { telaSetup(err.message); }
  });
}

// ---------- estrutura ----------
function casca(corpo, acao = "") {
  app.innerHTML = `<header class="top"><div class="brand"><img src="/logo.png" alt=""><div><b>MOVIVITA</b><span>Coordenação • ${esc(st.eu.nome.split(" ")[0])}</span></div></div>
    <div class="inline">${acao}<button class="linkbtn" data-act="ajustes" type="button">Ajustes</button><button class="linkbtn" data-act="sair" type="button">Sair</button></div></header>
    <main class="main">${corpo}</main>
    <nav class="tabs" role="tablist" style="grid-template-columns:repeat(3,1fr)">
      ${[["cobertura", "Cobertura"], ["conferencia", "Conferência"], ["cadastros", "Cadastros"]].map(([k, t]) =>
        `<button class="tab" role="tab" aria-selected="${st.aba === k}" data-aba="${k}" type="button">${t}</button>`).join("")}
    </nav>`;
}

async function irPara(aba) {
  st.aba = aba;
  if (aba === "cobertura") { await carregarSemana(); }
  else if (aba === "conferencia") { await carregarConf(); }
  else { await carregarCad(); }
}

async function atualizar() {
  if (st.aba === "cobertura") await carregarSemana(false);
  else if (st.aba === "conferencia") await carregarConf(false);
  else await carregarCad(false);
}

// ---------- cobertura ----------
const lacuna = (p) => !["aceito", "cancelado", "conferencia", "realizado", "naorealizado"].includes(p.status);

async function carregarSemana(spinner = true) {
  if (spinner) casca(carregando());
  st.sem = await api(`/coord/semana?ini=${st.semana}`);
  renderSemana();
}

function rotuloPlantao(p) {
  const nome = p.cuidadora || "";
  switch (p.status) {
    case "rascunho": return p.cuidadoraId ? `Sugerido para ${nome}${p.conflito ? " • ATENÇÃO: " + p.conflito : ""}` : "Sem sugestão de cuidadora";
    case "convite": return `Convite para ${nome}`;
    case "aberta": return "Visível a todas as habilitadas";
    case "aceito": return `${nome} aceitou`;
    case "novoaceite": return `Alterado, aguardando novo aceite de ${nome}`;
    case "aguardando": return "Recusado ou devolvido. Decida o próximo passo";
    case "conferencia": return `${nome} • plantão encerrado, falta conferir`;
    case "realizado": return `${nome} • realizado${p.fechado ? " • período fechado" : ""}`;
    case "naorealizado": return `${nome} • ${p.motivo || "não realizado"}`;
    case "cancelado": return p.motivo || "Cancelado";
  }
  return "";
}

function renderSemana() {
  const s = st.sem, hoje = s.hoje;
  const lista = s.plantoes.filter((p) => !st.filtroFam || String(p.familiaId) === st.filtroFam);
  const ativos = lista.filter((p) => p.status !== "cancelado");
  const k = {
    lac: ativos.filter(lacuna).length,
    ac: ativos.filter((p) => ["aceito", "conferencia", "realizado"].includes(p.status)).length,
    pend: ativos.filter((p) => ["convite", "aberta", "novoaceite"].includes(p.status)).length,
    ag: ativos.filter((p) => p.status === "aguardando").length,
  };
  const futura = s.ini > hoje;
  const tag = s.fim < hoje ? "passada" : s.ini <= hoje ? "em curso" : "futura";
  const rasc = s.plantoes.filter((p) => p.status === "rascunho");
  const sug = rasc.filter((p) => p.cuidadoraId), conf = sug.filter((p) => p.conflito);
  const dias = {};
  lista.forEach((p) => (dias[p.data] ||= []).push(p));
  const dist = futura || rasc.length ? `<div class="card" style="background:var(--lav);border-color:var(--lav2)">
      <b style="color:var(--roxo)">Distribuição da semana</b>
      <div class="meta" style="color:var(--ink)"><span>Indisponibilidades até <b>${dt(s.prazoIndisp)}</b></span><span>Envio na <b>${dt(s.envio)}</b></span></div>
      <div class="kpis">
        <button class="kpi" style="text-align:left;background:var(--surface)" data-act="verIndisp" type="button"><b>${s.indisp.length}</b><span>Indisponibilidades informadas • ver</span></button>
        <div class="kpi ${conf.length ? "alert" : ""}" style="${conf.length ? "" : "background:var(--surface)"}"><b>${conf.length}</b><span>Sugestões em conflito</span></div>
        <div class="kpi" style="background:var(--surface)"><b>${sug.length}</b><span>Rascunhos com sugestão</span></div>
        <div class="kpi" style="background:var(--surface)"><b>${rasc.length - sug.length}</b><span>Rascunhos sem sugestão</span></div>
      </div>
      <button class="btn ghost full" data-act="copiar" type="button">Copiar padrão da semana anterior</button>
      <button class="btn yes full" data-act="enviarDist" type="button" ${sug.length - conf.length ? "" : "disabled"}>Enviar convites da semana (${sug.length - conf.length})</button>
      <p class="hint" style="margin:0">Cada cuidadora recebe os convites sugeridos para ela e responde livremente. Sugestões em conflito e rascunhos sem sugestão ficam aguardando a sua decisão.</p>
    </div>` : "";
  casca(`
    <div class="weeknav"><button data-act="semAnt" type="button" aria-label="Semana anterior">‹</button>
      <div style="text-align:center"><h1 style="font-size:19px">Semana de ${dataCurta(s.ini)} a ${dataCurta(s.fim)}</h1><p class="sub">${tag}${s.fechado ? " • período fechado" : ""}${segundaDe(hoje) !== s.ini ? ` • <button class="linkbtn" style="padding:0" data-act="semHoje" type="button">ir para hoje</button>` : ""}</p></div>
      <button data-act="semProx" type="button" aria-label="Próxima semana">›</button></div>
    ${dist}
    <div class="kpis">
      <div class="kpi ${k.lac ? "alert" : ""}"><b>${k.lac}</b><span>Lacunas de cobertura</span></div>
      <div class="kpi"><b>${k.ac}</b><span>Plantões cobertos</span></div>
      <div class="kpi"><b>${k.pend}</b><span>Convites e ofertas pendentes</span></div>
      <div class="kpi"><b>${k.ag}</b><span>Aguardando Coordenação</span></div>
    </div>
    <div class="field"><label for="filtroFam" class="sr">Família</label><select id="filtroFam"><option value="">Todas as famílias</option>
      ${s.familias.map((f) => `<option value="${f.id}" ${String(f.id) === st.filtroFam ? "selected" : ""}>${esc(f.apelido)}</option>`).join("")}</select></div>
    ${Object.keys(dias).sort().map((d) => `<div class="dayh">${dt(d)}</div>${dias[d].map((p) => `
      <button class="slot ${lacuna(p) && p.status !== "rascunho" ? "gap" : ""}" data-act="plantao" data-id="${p.id}" type="button">
        <span><span class="f">${esc(p.familia)}</span> <span class="t">${faixa(p.hora, p.duracao)}</span></span>
        ${p.prazoVencido ? pill("lacuna", "Prazo vencido") : p.emAndamento ? pill("aceito", "Em andamento") : pill(p.status)}
        <span class="w">${esc(rotuloPlantao(p))}</span></button>`).join("")}`).join("") || `<div class="empty">Nenhum plantão nesta semana. Use + Plantão ou copie o padrão da semana anterior.</div>`}`,
    `<button class="linkbtn" data-act="novo" type="button">+ Plantão</button>`);
  $("#filtroFam").addEventListener("change", (e) => { st.filtroFam = e.target.value; renderSemana(); });
}

async function folhaPlantao(id) {
  const folha = abrirFolha(carregando());
  let d;
  try { d = await api(`/coord/plantoes/${id}`); } catch (e) { folha.innerHTML = `<p class="err">${esc(e.message)}</p><button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`; return; }
  const p = d.plantao;
  const passado = ["conferencia", "realizado", "naorealizado"].includes(p.status);
  const futuro = new Date(p.inicio) > new Date();
  const ofertavel = futuro && ["rascunho", "convite", "aberta", "aguardando", "novoaceite"].includes(p.status);
  const alteravel = futuro && !["cancelado", "realizado", "naorealizado"].includes(p.status);
  const cobrir = p.status === "aguardando" || p.prazoVencido;
  const rasc = p.status === "rascunho";
  folha.innerHTML = `<h3>${esc(p.familia)} • ${dt(p.data)}</h3>
    <div class="meta"><span>${faixa(p.hora, p.duracao)}</span><span>${p.duracao} horas</span><span>Versão ${p.versao}</span>${p.valor != null ? `<span>${brl(p.valor)}</span>` : ""}${p.cuidadora ? `<span>${esc(p.cuidadora)}</span>` : ""}${p.prazo && ["convite", "aberta"].includes(p.status) ? `<span>Prazo ${dataHora(p.prazo)}</span>` : ""}</div>
    <div class="inline">${p.prazoVencido ? pill("lacuna", "Prazo vencido") : p.emAndamento ? pill("aceito", "Em andamento") : pill(p.status)}${p.fechado ? pill("fechado", "Período fechado") : ""}</div>
    ${passado && !p.fechado ? `<h2>Conferência</h2><div class="grid2">
      <button class="btn ${p.status === "realizado" ? "ghost" : "yes"}" data-act="conferir" data-id="${p.id}" type="button">Realizado</button>
      <button class="btn ghost" data-act="naoRealizado" data-id="${p.id}" type="button">Não realizado</button></div>` : ""}
    ${passado && p.fechado && p.status !== "conferencia" ? `<button class="btn ghost full" data-act="ajuste" data-id="${p.id}" type="button">Registrar ajuste</button><p class="hint" style="margin:0">O período está fechado. Correções entram como ajuste registrado, sem apagar o que já existe.</p>` : ""}
    ${ofertavel ? `<h2>${cobrir ? "Quem pode cobrir" : rasc ? "Sugerir cuidadora (enviada na distribuição)" : "Convite direto"}</h2>
      <p class="hint" style="margin:0">Cuidadoras habilitadas nesta família. As livres no horário aparecem primeiro.</p>
      ${d.candidatos.map((c) => {
        const atual = p.cuidadoraId === c.id;
        const tags = c.bloqueio ? `<span class="tag bl">${esc(c.bloqueio)}</span>` : c.avisos.length ? c.avisos.map((a) => `<span class="tag av">${esc(a)}</span>`).join("") : `<span class="tag ok">Livre no horário</span>`;
        return `<button class="opt" ${c.bloqueio && !atual ? "disabled" : ""} data-act="${rasc ? "sugerir" : "convidar"}" data-id="${p.id}" data-c="${c.id}" type="button">
          <span>${esc(c.nome)}${tags}</span><small>${atual ? "atual" : c.bloqueio ? "indisponível" : rasc ? "sugerir" : "enviar convite"}</small></button>`;
      }).join("") || `<p class="hint">Nenhuma cuidadora habilitada nesta família. Ajuste em Cadastros.</p>`}
      ${rasc && p.cuidadoraId ? `<button class="linkbtn" style="align-self:flex-start" data-act="semSugestao" data-id="${p.id}" type="button">Remover sugestão</button>` : ""}
      ${rasc ? `<button class="linkbtn" style="align-self:flex-start" data-act="convidarAgora" data-id="${p.id}" type="button">Enviar convite agora, fora da distribuição</button>` : ""}` : ""}
    ${alteravel ? `<div class="grid2">
      ${ofertavel ? `<button class="btn ghost" data-act="abrir" data-id="${p.id}" type="button">Abrir oferta</button>` : ""}
      <button class="btn ghost" data-act="alterar" data-id="${p.id}" type="button">Alterar</button></div>
      <button class="linkbtn" style="color:var(--red);align-self:flex-start" data-act="cancelar" data-id="${p.id}" type="button">Cancelar plantão</button>` : ""}
    <h2>Histórico</h2>
    <div class="log">${d.historico.map((h) => `<div><time>${dataHora(h.em)} • ${esc(h.autor_nome)}</time>${esc(h.texto)}</div>`).join("")}</div>
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`;
  folha.dataset.plantao = JSON.stringify(p);
  folha.dataset.candidatos = JSON.stringify(d.candidatos);
}

const opcoesHora = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${String(h).padStart(2, "0")}h</option>`).join("");
const opcoesDur = (sel) => [4, 6, 8, 10, 12, 24].concat(sel && ![4, 6, 8, 10, 12, 24].includes(sel) ? [sel] : []).map((v) => `<option value="${v}" ${v === sel ? "selected" : ""}>${v} horas</option>`).join("");

function folhaNovo() {
  const fams = st.sem.familias;
  const dataPadrao = st.sem.ini > hojeSP() ? st.sem.ini : hojeSP();
  abrirFolha(`<h3>Novo plantão</h3>
    <div class="field"><label for="nFam">Família</label><select id="nFam">${fams.map((f) => `<option value="${f.id}" ${String(f.id) === st.filtroFam ? "selected" : ""}>${esc(f.apelido)}</option>`).join("")}</select></div>
    <div class="grid2">
      <div class="field"><label for="nData">Data</label><input id="nData" type="date" value="${dataPadrao}"></div>
      <div class="field"><label for="nRep">Repetir por</label><select id="nRep">${[1, 2, 3, 4, 5, 6, 7, 14].map((n) => `<option value="${n}">${n === 1 ? "só este dia" : n + " dias seguidos"}</option>`).join("")}</select></div>
      <div class="field"><label for="nHora">Início</label><select id="nHora">${opcoesHora(7)}</select></div>
      <div class="field"><label for="nDur">Duração</label><select id="nDur">${opcoesDur(12)}</select></div>
    </div>
    <div class="field"><label for="nValor">Valor do plantão para a cuidadora (opcional)</label><input id="nValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ex.: 180"></div>
    <p class="hint" style="margin:0">O plantão nasce como rascunho. Depois você sugere uma cuidadora ou envia o convite.</p>
    <button class="btn prim full" data-act="criar" type="button">Criar</button>
    <button class="btn ghost full" data-act="fechar" type="button">Cancelar</button>`);
}

function folhaAlterar(p) {
  abrirFolha(`<h3>Alterar plantão</h3><p class="sub">${esc(p.familia)} • atual ${dt(p.data)}, ${faixa(p.hora, p.duracao)}</p>
    ${p.status === "aceito" ? `<div class="warn">Este plantão já foi aceito por ${esc(p.cuidadora)}. Mudar data, horário, duração ou valor invalida o aceite e envia a nova versão para novo aceite.</div>` : ""}
    <div class="grid2">
      <div class="field"><label for="aData">Data</label><input id="aData" type="date" value="${p.data}"></div>
      <div class="field"><label for="aValor">Valor (opcional)</label><input id="aValor" type="number" min="0" step="0.01" value="${p.valor ?? ""}"></div>
      <div class="field"><label for="aHora">Início</label><select id="aHora">${opcoesHora(p.hora)}</select></div>
      <div class="field"><label for="aDur">Duração</label><select id="aDur">${opcoesDur(p.duracao)}</select></div>
    </div>
    <button class="btn prim full" data-act="salvarAlteracao" data-id="${p.id}" type="button">Salvar alteração</button>
    <button class="btn ghost full" data-act="plantao" data-id="${p.id}" type="button">Voltar</button>`);
}

function folhaCancelar(p) {
  abrirFolha(`<h3>Cancelar plantão</h3><p class="sub">${esc(p.familia)} • ${dt(p.data)} • ${faixa(p.hora, p.duracao)}</p>
    ${p.cuidadora && ["aceito", "convite", "novoaceite"].includes(p.status) ? `<div class="warn">${esc(p.cuidadora)} será avisada do cancelamento.</div>` : ""}
    <div class="field"><label for="cMot">Motivo (opcional)</label><input id="cMot" maxlength="200"></div>
    <button class="btn prim full" data-act="confirmarCancelar" data-id="${p.id}" type="button">Cancelar plantão</button>
    <button class="btn ghost full" data-act="plantao" data-id="${p.id}" type="button">Voltar</button>`);
}

function folhaNaoRealizado(id) {
  abrirFolha(`<h3>Plantão não realizado</h3>
    <div class="field"><label for="nrMot">Motivo</label><select id="nrMot"><option>Falta sem aviso</option><option>Imprevisto comunicado em cima da hora</option><option>Atendimento cancelado pela família no dia</option><option>Outro</option></select></div>
    <div class="field"><label for="nrObs">Observação (opcional)</label><input id="nrObs" maxlength="150"></div>
    <button class="btn prim full" data-act="confirmarNaoRealizado" data-id="${id}" type="button">Registrar como não realizado</button>
    <button class="btn ghost full" data-act="fechar" type="button">Cancelar</button>`);
}

function folhaAjuste(p) {
  abrirFolha(`<h3>Registrar ajuste</h3><p class="sub">${esc(p.familia)} • ${dt(p.data)} • atual: ${ROTULO[p.status]}</p>
    <div class="field"><label for="ajSt">Nova situação</label><select id="ajSt"><option value="realizado">Realizado</option><option value="naorealizado">Não realizado</option></select></div>
    <div class="field"><label for="ajMot">Motivo do ajuste (obrigatório)</label><input id="ajMot" maxlength="200" placeholder="Ex.: família confirmou o atendimento"></div>
    <button class="btn prim full" data-act="confirmarAjuste" data-id="${p.id}" type="button">Registrar ajuste</button>
    <button class="btn ghost full" data-act="fechar" type="button">Cancelar</button>`);
}

function folhaIndisp() {
  const s = st.sem;
  abrirFolha(`<h3>Indisponibilidades • ${dataCurta(s.ini)} a ${dataCurta(s.fim)}</h3><p class="sub">Informadas pelas cuidadoras. Prazo: ${dt(s.prazoIndisp)}.</p>
    <div class="card" style="padding:4px 16px">${s.indisp.map((i) => `<div class="row"><div><div class="d">${dt(i.data)} • ${i.turno === "dia" ? "Dia" : "Noite"}</div><div class="h">Informado em ${dataHora(i.em)}${i.em.slice(0, 10) > s.prazoIndisp ? " • após o prazo" : ""}</div></div><div class="who">${esc(i.nome)}</div></div>`).join("") || `<div class="empty">Nenhuma indisponibilidade informada.</div>`}</div>
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`);
}

// ---------- conferência ----------
async function carregarConf(spinner = true) {
  if (spinner) casca(carregando());
  const [c, cad] = await Promise.all([api(`/coord/conferencia?ini=${st.conf}`), st.cad ? Promise.resolve(st.cad) : api("/coord/cadastros")]);
  st.confDados = c; st.cad = cad;
  renderConf();
}

function renderConf() {
  const c = st.confDados, hoje = hojeSP();
  const real = c.itens.filter((p) => p.status === "realizado"), pend = c.itens.filter((p) => p.status === "conferencia"), nao = c.itens.filter((p) => p.status === "naorealizado");
  const horas = real.reduce((a, p) => a + p.duracao, 0);
  const pode = !c.fechamento && !pend.length && !c.futuros;
  const motivo = c.fechamento ? "" : pend.length ? (pend.length === 1 ? "Confira o plantão pendente para poder fechar." : `Confira os ${pend.length} plantões pendentes para poder fechar.`) : c.futuros ? "O período ainda tem plantões por acontecer." : "";
  const alvos = st.extTipo === "cuid" ? st.cad.cuidadoras.map((x) => [x.id, x.nome + (x.ativa ? "" : " (inativa)")]) : st.cad.familias.map((x) => [x.id, x.apelido + (x.ativa ? "" : " (inativa)")]);
  casca(`
    <div class="weeknav"><button data-act="confAnt" type="button" aria-label="Semana anterior">‹</button>
      <div style="text-align:center"><h1 style="font-size:19px">Conferência ${dataCurta(c.ini)} a ${dataCurta(c.fim)}</h1><p class="sub">${c.fechamento ? `Fechado em ${dataHora(c.fechamento.fechado_em)} por ${esc(c.fechamento.fechado_por)}` : c.fim < hoje ? "Período encerrado, aberto para conferência" : "Período em curso"}</p></div>
      <button data-act="confProx" type="button" aria-label="Próxima semana">›</button></div>
    <div class="kpis">
      <div class="kpi"><b>${real.length}</b><span>Realizados e conferidos</span></div>
      <div class="kpi ${pend.length ? "alert" : ""}"><b>${pend.length}</b><span>Aguardando conferência</span></div>
      <div class="kpi"><b>${nao.length}</b><span>Não realizados</span></div>
      <div class="kpi"><b>${horas}h</b><span>Horas realizadas</span></div>
    </div>
    ${pend.length ? `<h2>Pendentes de conferência</h2>
      <div class="card" style="padding:4px 16px">${pend.map((p) => `<div class="row"><div><div class="d">${dt(p.data)} • ${faixa(p.hora, p.duracao)}</div><div class="h">${esc(p.familia)} • ${esc(p.cuidadora)}</div></div>
        <div class="inline"><button class="mini ok" data-act="conferir" data-id="${p.id}" type="button">Realizado</button><button class="mini" data-act="naoRealizado" data-id="${p.id}" type="button">Não</button></div></div>`).join("")}</div>
      <button class="btn ghost full" data-act="lote" type="button">${pend.length === 1 ? "Confirmar o pendente como realizado" : `Confirmar os ${pend.length} pendentes como realizados`}</button>
      <p class="hint" style="margin:0">Use a confirmação em lote só depois de conferir com a cuidadora ou com a família.</p>` : ""}
    ${nao.length ? `<h2>Não realizados</h2><div class="card" style="padding:4px 16px">${nao.map((p) => `<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;padding-inline:0" data-act="plantao" data-id="${p.id}" type="button"><div><div class="d">${dt(p.data)} • ${faixa(p.hora, p.duracao)}</div><div class="h">${esc(p.familia)} • ${esc(p.cuidadora)} • ${esc(p.motivo || "")}</div></div></button>`).join("")}</div>` : ""}
    ${!c.fechamento ? `<button class="btn prim full" data-act="fecharPeriodo" type="button" ${pode ? "" : "disabled"}>Fechar período ${dataCurta(c.ini)} a ${dataCurta(c.fim)}</button>${motivo ? `<p class="hint" style="margin:0">${motivo}</p>` : ""}` : ""}
    <h2>Extrato</h2>
    <div class="chips" role="group" aria-label="Tipo de extrato">
      <button class="chip" aria-pressed="${st.extTipo === "cuid"}" data-ext="cuid" type="button">Por cuidadora</button>
      <button class="chip" aria-pressed="${st.extTipo === "fam"}" data-ext="fam" type="button">Por família</button>
    </div>
    <div class="field"><label for="extAlvo">${st.extTipo === "cuid" ? "Cuidadora" : "Família"}</label><select id="extAlvo">${alvos.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}</select></div>
    <div class="grid2"><div class="field"><label for="extIni">De</label><input id="extIni" type="date" value="${c.ini}"></div><div class="field"><label for="extFim">Até</label><input id="extFim" type="date" value="${c.fim}"></div></div>
    ${st.extTipo === "fam" ? `<p class="hint" style="margin:0">A versão por família pode ser entregue à família. Mostra só o primeiro nome das cuidadoras e nenhum valor.</p>` : ""}
    <button class="btn yes full" data-act="gerarExtrato" type="button" ${alvos.length ? "" : "disabled"}>Gerar extrato</button>`);
}

async function folhaExtrato() {
  const id = $("#extAlvo").value, ini = $("#extIni").value, fim = $("#extFim").value;
  const folha = abrirFolha(`<h3>Extrato</h3><div id="doc">${carregando()}</div>
    <button class="btn prim full" data-act="pdf" type="button" disabled>Baixar PDF</button>
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`);
  try {
    const ex = await api(`/coord/extrato?tipo=${st.extTipo}&id=${id}&ini=${ini}&fim=${fim}`);
    $("#doc", folha).innerHTML = htmlExtrato(ex);
    const b = $("[data-act=pdf]", folha);
    b.disabled = false;
    b.onclick = () => baixarPDF(ex).catch(() => toast("Não foi possível gerar o PDF."));
  } catch (e) { $("#doc", folha).innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---------- cadastros ----------
const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function carregarCad(spinner = true) {
  if (spinner) casca(carregando());
  st.cad = await api("/coord/cadastros");
  renderCad();
}

function linhasCad() {
  const q = st.busca.trim(), qd = q.replace(/\D/g, "");
  const famNome = Object.fromEntries(st.cad.familias.map((f) => [f.id, f.apelido]));
  const cuidNome = Object.fromEntries(st.cad.cuidadoras.map((c) => [c.id, c.nome]));
  const botao = 'class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;padding-inline:0"';
  if (st.cadSeg === "cuid") {
    const l = st.cad.cuidadoras.filter((c) => !q || norm(c.nome).includes(norm(q)) || (qd.length >= 3 && c.celular.replace(/\D/g, "").includes(qd)) || c.familias.some((f) => norm(famNome[f] || "").includes(norm(q))));
    return l.map((c) => `<button ${botao} data-act="cuid" data-id="${c.id}" type="button"><div><div class="d">${esc(c.nome)}</div>
      <div class="h">${esc(c.celular)}${c.pin_provisorio && c.ativa ? " • ainda não criou o PIN pessoal" : ""}<br>${c.familias.map((f) => famNome[f]).filter(Boolean).map(esc).join(", ") || "Nenhuma família habilitada"}</div></div>
      ${c.ativa ? pill("realizado", "Ativa") : pill("cancelado", "Inativa")}</button>`).join("") || `<div class="empty">Nenhuma cuidadora encontrada.</div>`;
  }
  const l = st.cad.familias.filter((f) => !q || norm(f.apelido + " " + f.bairro).includes(norm(q)));
  return l.map((f) => `<button ${botao} data-act="fam" data-id="${f.id}" type="button"><div><div class="d">${esc(f.apelido)}</div>
    <div class="h">${esc(f.bairro)}<br>Habilitadas: ${f.cuidadoras.map((c) => cuidNome[c]).filter(Boolean).map(esc).join(", ") || "nenhuma"}</div></div>
    ${f.ativa ? pill("realizado", "Ativa") : pill("cancelado", "Inativa")}</button>`).join("") || `<div class="empty">Nenhuma família encontrada.</div>`;
}

function renderCad() {
  const nC = st.cad.cuidadoras.filter((c) => c.ativa).length, nF = st.cad.familias.filter((f) => f.ativa).length;
  casca(`<div><h1>Cadastros</h1><p class="sub">${nC} cuidadoras ativas • ${nF} famílias ativas</p></div>
    <div class="chips" role="group" aria-label="Tipo de cadastro">
      <button class="chip" aria-pressed="${st.cadSeg === "cuid"}" data-seg="cuid" type="button">Cuidadoras</button>
      <button class="chip" aria-pressed="${st.cadSeg === "fam"}" data-seg="fam" type="button">Famílias</button>
    </div>
    <div class="field"><label for="busca" class="sr">Buscar</label><input id="busca" type="search" value="${esc(st.busca)}" autocomplete="off" placeholder="${st.cadSeg === "cuid" ? "Buscar por nome, celular ou família" : "Buscar por família ou bairro"}"></div>
    <div style="display:flex;justify-content:flex-end"><button class="linkbtn" data-act="${st.cadSeg === "cuid" ? "cuid" : "fam"}" data-id="0" type="button">${st.cadSeg === "cuid" ? "+ Nova cuidadora" : "+ Nova família"}</button></div>
    <div class="card" style="padding:4px 16px" id="cadLista">${linhasCad()}</div>
    <p class="hint">Só as cuidadoras habilitadas em uma família recebem convites e veem a cobertura dela. Retirar a habilitação ou inativar revoga o acesso na hora, e os plantões futuros voltam para a Coordenação.</p>`);
  $("#busca").addEventListener("input", (e) => { st.busca = e.target.value; $("#cadLista").innerHTML = linhasCad(); });
}

function folhaCuid(id) {
  const c = id ? st.cad.cuidadoras.find((x) => x.id === id) : { nome: "", celular: "", familias: [], ativa: true };
  abrirFolha(`<h3>${id ? "Editar cuidadora" : "Nova cuidadora"}</h3>
    <div class="field"><label for="cNome">Nome completo</label><input id="cNome" value="${esc(c.nome)}" maxlength="80"></div>
    <div class="field"><label for="cCel">Celular com DDD</label><input id="cCel" inputmode="tel" value="${esc(c.celular)}" placeholder="(62) 90000-0000"></div>
    <h2>Habilitada nas famílias</h2>
    ${st.cad.familias.filter((f) => f.ativa).map((f) => `<label class="opt"><span>${esc(f.apelido)} <small>• ${esc(f.bairro)}</small></span><input type="checkbox" class="hf" value="${f.id}" ${c.familias.includes(f.id) ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--roxo)"></label>`).join("") || `<p class="hint">Cadastre uma família primeiro.</p>`}
    <button class="btn prim full" data-act="salvarCuid" data-id="${id || 0}" type="button">${id ? "Salvar" : "Cadastrar e gerar PIN"}</button>
    ${id ? `<div class="grid2"><button class="btn ghost" data-act="pin" data-id="${id}" type="button">Redefinir PIN</button>
      ${c.ativa ? `<button class="btn ghost" style="color:var(--red)" data-act="inativarCuid" data-id="${id}" type="button">Inativar</button>` : `<button class="btn ghost" data-act="reativarCuid" data-id="${id}" type="button">Reativar</button>`}</div>
      <button class="linkbtn" style="color:var(--red);align-self:flex-start" data-act="excluirAsk" data-tipo="cuid" data-id="${id}" type="button">Excluir cadastro</button>` : ""}
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`);
}

function folhaFam(id) {
  const f = id ? st.cad.familias.find((x) => x.id === id) : { apelido: "", bairro: "", cuidadoras: [], ativa: true };
  abrirFolha(`<h3>${id ? "Editar família" : "Nova família"}</h3>
    <div class="field"><label for="fApelido">Identificação na escala</label><input id="fApelido" value="${esc(f.apelido)}" maxlength="60" placeholder="Família R."></div>
    <p class="hint" style="margin:0">Use um apelido operacional, como "Família R.". O nome completo da pessoa assistida não deve aparecer na escala.</p>
    <div class="field"><label for="fBairro">Bairro</label><input id="fBairro" value="${esc(f.bairro)}" maxlength="60"></div>
    <h2>Cuidadoras habilitadas</h2>
    <input id="fBusca" type="search" placeholder="Filtrar cuidadoras" style="padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;background:var(--surface);font:inherit">
    <div id="fLista" style="display:flex;flex-direction:column;gap:8px">${st.cad.cuidadoras.filter((c) => c.ativa).map((c) => `<label class="opt" data-nome="${esc(norm(c.nome))}"><span>${esc(c.nome)}</span><input type="checkbox" class="hc" value="${c.id}" ${f.cuidadoras.includes(c.id) ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--roxo)"></label>`).join("")}</div>
    <button class="btn prim full" data-act="salvarFam" data-id="${id || 0}" type="button">${id ? "Salvar" : "Cadastrar família"}</button>
    ${id ? (f.ativa ? `<button class="linkbtn" style="color:var(--red);align-self:flex-start" data-act="inativarFam" data-id="${id}" type="button">Inativar família</button>` : `<button class="btn ghost full" data-act="reativarFam" data-id="${id}" type="button">Reativar família</button>`) : ""}
    ${id ? `<button class="linkbtn" style="color:var(--red);align-self:flex-start" data-act="excluirAsk" data-tipo="fam" data-id="${id}" type="button">Excluir cadastro</button>` : ""}
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`);
  $("#fBusca").addEventListener("input", (e) => {
    const v = norm(e.target.value);
    document.querySelectorAll("#fLista .opt").forEach((o) => (o.hidden = v && !o.dataset.nome.includes(v)));
  });
}

function folhaPin(nome, pin, novo) {
  abrirFolha(`<h3>${novo ? "Cuidadora cadastrada" : "PIN provisório"}</h3>
    <p style="margin:0">PIN provisório de <b>${esc(nome)}</b></p>
    <div class="bigpin">${esc(pin)}</div>
    <p class="hint">Anote agora: por segurança, este PIN não aparece de novo. Passe-o à cuidadora pessoalmente ou por mensagem individual, junto com o endereço da Escala (${esc(location.origin)}). Na primeira entrada, ela cria um PIN próprio.</p>
    <button class="btn prim full" data-act="fechar" type="button">Pronto</button>`);
}

function folhaExcluir(tipo, id) {
  const nome = tipo === "cuid" ? st.cad.cuidadoras.find((c) => c.id === id)?.nome : st.cad.familias.find((f) => f.id === id)?.apelido;
  abrirFolha(`<h3>Excluir ${esc(nome)}?</h3>
    <p style="margin:0">A exclusão é definitiva e serve para cadastros feitos por engano ou de teste. Ela só é possível quando ${tipo === "cuid" ? "a cuidadora nunca participou de nenhum plantão" : "a família não tem nenhum plantão registrado"}.</p>
    <p class="hint" style="margin:0">Para quem já tem histórico, use ${tipo === "cuid" ? "Inativar" : "Inativar família"}: o acesso deixa de existir e os registros ficam preservados.</p>
    <button class="btn prim full" style="background:var(--red)" data-act="excluir" data-tipo="${tipo}" data-id="${id}" type="button">Excluir definitivamente</button>
    <button class="btn ghost full" data-act="fechar" type="button">Cancelar</button>`);
}

// ---------- ajustes ----------
async function folhaAjustes() {
  const folha = abrirFolha(carregando());
  const c = await api("/coord/config");
  folha.innerHTML = `<h3>Ajustes</h3>
    <div class="grid2">
      <div class="field"><label for="cfDesc">Descanso mínimo entre plantões (horas)</label><input id="cfDesc" type="number" min="0" max="48" value="${c.descansoMin}"></div>
      <div class="field"><label for="cfPrazo">Prazo padrão de resposta (horas)</label><input id="cfPrazo" type="number" min="2" max="240" value="${c.prazoPadraoH}"></div>
    </div>
    <label class="check"><input id="cfValor" type="checkbox" ${c.mostrarValor ? "checked" : ""}> Mostrar o valor do plantão no convite da cuidadora</label>
    <button class="btn prim full" data-act="salvarConfig" type="button">Salvar ajustes</button>
    <h2>Acessos da Coordenação</h2>
    <div class="card" style="padding:4px 16px">${c.coordenadores.map((x) => `<div class="row"><div><div class="d">${esc(x.nome)}</div><div class="h">${esc(x.email)}</div></div>
      ${x.email === st.eu.email ? pill("realizado", "Você") : `<div class="inline" style="gap:6px"><button class="mini" data-act="coordAtivo" data-id="${x.id}" data-v="${x.ativo ? 0 : 1}" type="button">${x.ativo ? "Desativar" : "Reativar"}</button><button class="mini" style="color:var(--red)" data-act="coordExcluirAsk" data-id="${x.id}" data-nome="${esc(x.nome)}" data-email="${esc(x.email)}" type="button">Excluir</button></div>`}</div>`).join("")}</div>
    <div class="grid2"><div class="field"><label for="ncNome">Nome</label><input id="ncNome"></div><div class="field"><label for="ncEmail">E-mail</label><input id="ncEmail" type="email"></div></div>
    <div class="field"><label for="ncSenha">Senha provisória (mínimo de 8 caracteres)</label><input id="ncSenha" type="text" autocomplete="off"></div>
    <button class="btn ghost full" data-act="novoCoord" type="button">Criar acesso</button>
    <h2>Minha senha</h2>
    <div class="grid2"><div class="field"><label for="sAtual">Senha atual</label><input id="sAtual" type="password" autocomplete="current-password"></div><div class="field"><label for="sNova">Nova senha</label><input id="sNova" type="password" autocomplete="new-password"></div></div>
    <button class="btn ghost full" data-act="trocarSenha" type="button">Alterar senha</button>
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`;
}

// ---------- ações ----------
async function executar(fn) {
  if (ocupado) return;
  ocupado = true;
  try { await fn(); }
  catch (e) { if (e.status === 401) { fecharFolha(); telaEntrar("Sua sessão terminou. Entre novamente."); } else toast(e.message); }
  finally { ocupado = false; }
}

async function acao(caminho, dados, { fechar = true } = {}) {
  const r = await api(caminho, { metodo: "POST", dados });
  if (fechar) fecharFolha();
  toast(r.mensagem || "Pronto.");
  await atualizar();
  return r;
}

const plantaoDaFolha = () => JSON.parse($("#folha .sheet")?.dataset.plantao || "null");
const checados = (sel) => [...document.querySelectorAll(sel)].filter((i) => i.checked).map((i) => Number(i.value));

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-aba],[data-seg],[data-ext]");
  if (!t) return;
  if (t.dataset.aba) return executar(() => irPara(t.dataset.aba));
  if (t.dataset.seg) { st.cadSeg = t.dataset.seg; st.busca = ""; return renderCad(); }
  if (t.dataset.ext) { st.extTipo = t.dataset.ext; return renderConf(); }
  const id = Number(t.dataset.id);
  switch (t.dataset.act) {
    case "fechar": return fecharFolha();
    case "sair": return executar(async () => { await api("/sair", { metodo: "POST", dados: { tipo: "coord" } }); telaEntrar(); });
    case "ajustes": return executar(folhaAjustes);
    case "semAnt": st.semana = addDias(st.semana, -7); return executar(() => carregarSemana());
    case "semProx": st.semana = addDias(st.semana, 7); return executar(() => carregarSemana());
    case "semHoje": st.semana = segundaDe(hojeSP()); return executar(() => carregarSemana());
    case "confAnt": st.conf = addDias(st.conf, -7); return executar(() => carregarConf());
    case "confProx": st.conf = addDias(st.conf, 7); return executar(() => carregarConf());
    case "plantao": return executar(() => folhaPlantao(id));
    case "novo": return folhaNovo();
    case "verIndisp": return folhaIndisp();
    case "criar": return executar(() => acao("/coord/plantoes", {
      familiaId: $("#nFam").value, data: $("#nData").value, hora: $("#nHora").value, duracao: $("#nDur").value, valor: $("#nValor").value, repetirDias: $("#nRep").value,
    }));
    case "sugerir": return executar(() => acao(`/coord/plantoes/${id}/sugerir`, { cuidadoraId: t.dataset.c }));
    case "semSugestao": return executar(() => acao(`/coord/plantoes/${id}/sugerir`, { cuidadoraId: null }));
    case "convidar": return executar(() => acao(`/coord/plantoes/${id}/convidar`, { cuidadoraId: t.dataset.c }));
    case "convidarAgora": {
      const p = plantaoDaFolha();
      if (!p.cuidadoraId) return toast("Sugira uma cuidadora primeiro.");
      return executar(() => acao(`/coord/plantoes/${id}/convidar`, { cuidadoraId: p.cuidadoraId }));
    }
    case "abrir": return executar(() => acao(`/coord/plantoes/${id}/abrir`, {}));
    case "alterar": return folhaAlterar(plantaoDaFolha());
    case "salvarAlteracao": return executar(() => acao(`/coord/plantoes/${id}/alterar`, { data: $("#aData").value, hora: $("#aHora").value, duracao: $("#aDur").value, valor: $("#aValor").value }));
    case "cancelar": return folhaCancelar(plantaoDaFolha());
    case "confirmarCancelar": return executar(() => acao(`/coord/plantoes/${id}/cancelar`, { motivo: $("#cMot").value }));
    case "conferir": return executar(() => acao(`/coord/plantoes/${id}/conferir`, { realizado: true }));
    case "naoRealizado": return folhaNaoRealizado(id);
    case "confirmarNaoRealizado": {
      const obs = $("#nrObs").value.trim();
      return executar(() => acao(`/coord/plantoes/${id}/conferir`, { realizado: false, motivo: $("#nrMot").value + (obs ? ". " + obs : "") }));
    }
    case "ajuste": return folhaAjuste(plantaoDaFolha());
    case "confirmarAjuste": return executar(() => acao(`/coord/plantoes/${id}/ajuste`, { status: $("#ajSt").value, motivo: $("#ajMot").value }));
    case "enviarDist": return executar(() => acao("/coord/distribuicao/enviar", { ini: st.semana }));
    case "copiar": return executar(() => acao("/coord/distribuicao/copiar", { de: addDias(st.semana, -7), para: st.semana }));
    case "lote": return executar(() => acao("/coord/conferencia/lote", { ini: st.conf }));
    case "fecharPeriodo": return executar(() => acao("/coord/periodos/fechar", { ini: st.conf }));
    case "gerarExtrato": return folhaExtrato();
    case "cuid": return folhaCuid(id);
    case "fam": return folhaFam(id);
    case "salvarCuid": return executar(async () => {
      const dados = { nome: $("#cNome").value, celular: $("#cCel").value, familias: checados(".hf") };
      if (id) await acao(`/coord/cuidadoras/${id}`, dados);
      else { const r = await acao("/coord/cuidadoras", dados, { fechar: false }); folhaPin(r.nome, r.pin, true); }
    });
    case "pin": return executar(async () => { const r = await acao(`/coord/cuidadoras/${id}/pin`, {}, { fechar: false }); folhaPin(r.nome, r.pin, false); });
    case "inativarCuid": return executar(() => acao(`/coord/cuidadoras/${id}/ativa`, { ativa: false }));
    case "reativarCuid": return executar(async () => {
      const r = await acao(`/coord/cuidadoras/${id}/ativa`, { ativa: true }, { fechar: false });
      folhaPin(st.cad.cuidadoras.find((c) => c.id === id)?.nome || "", r.pin, false);
    });
    case "excluirAsk": return folhaExcluir(t.dataset.tipo, id);
    case "excluir": return executar(() => acao(t.dataset.tipo === "cuid" ? `/coord/cuidadoras/${id}/excluir` : `/coord/familias/${id}/excluir`, {}));
    case "salvarFam": return executar(() => acao(id ? `/coord/familias/${id}` : "/coord/familias", { apelido: $("#fApelido").value, bairro: $("#fBairro").value, cuidadoras: checados(".hc") }));
    case "inativarFam": return executar(() => acao(`/coord/familias/${id}/ativa`, { ativa: false }));
    case "reativarFam": return executar(() => acao(`/coord/familias/${id}/ativa`, { ativa: true }));
    case "salvarConfig": return executar(() => acao("/coord/config", { descansoMin: $("#cfDesc").value, prazoPadraoH: $("#cfPrazo").value, mostrarValor: $("#cfValor").checked }));
    case "novoCoord": return executar(async () => {
      await acao("/coord/coordenadores", { nome: $("#ncNome").value, email: $("#ncEmail").value, senha: $("#ncSenha").value }, { fechar: false });
      await folhaAjustes();
    });
    case "coordExcluirAsk": return abrirFolha(`<h3>Excluir o acesso de ${esc(t.dataset.nome)}?</h3>
      <p class="sub">${esc(t.dataset.email)}</p>
      <p style="margin:0">A exclusão é definitiva e serve para acessos criados por engano. Ela só é possível se esse acesso nunca registrou nenhuma ação no sistema. Caso contrário, use Desativar.</p>
      <button class="btn prim full" style="background:var(--red)" data-act="coordExcluir" data-id="${id}" type="button">Excluir definitivamente</button>
      <button class="btn ghost full" data-act="ajustes" type="button">Voltar</button>`);
    case "coordExcluir": return executar(async () => { await acao(`/coord/coordenadores/${id}/excluir`, {}, { fechar: false }); await folhaAjustes(); });
    case "coordAtivo": return executar(async () => { await acao(`/coord/coordenadores/${id}/ativo`, { ativo: t.dataset.v === "1" }, { fechar: false }); await folhaAjustes(); });
    case "trocarSenha": return executar(() => acao("/coord/senha", { atual: $("#sAtual").value, nova: $("#sNova").value }, { fechar: false }));
  }
});

// Mantém o painel atualizado enquanto está aberto.
setInterval(() => { if (st.eu && document.visibilityState === "visible" && !$("#folha") && !ocupado) atualizar().catch(() => {}); }, 60000);

iniciar();
