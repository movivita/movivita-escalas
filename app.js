import {
  $, esc, api, dt, faixa, brl, dataHora, dataCurta, addDias, hojeSP, pill, toast, abrirFolha, fecharFolha, carregando,
  htmlExtrato, baixarPDF,
} from "/comum.js";

const app = $("#app");
let dados = null;
let aba = "convites";
let ocupado = false;

// ---------- início ----------
async function iniciar() {
  app.innerHTML = carregando();
  try {
    dados = await api("/eu");
    render();
    sincronizarAvisos();
  } catch (e) {
    if (e.status === 401) return telaEntrar();
    if (e.status === 403) return telaNovoPin();
    app.innerHTML = `<div class="main"><h1>Não foi possível carregar</h1><p class="sub">${esc(e.message)}</p><button class="btn prim full" data-act="recarregar" type="button">Tentar de novo</button></div>`;
  }
}

async function recarregar() {
  try { dados = await api("/eu"); render(); }
  catch (e) { if (e.status === 401) telaEntrar(); else toast(e.message); }
}

// ---------- entrada ----------
function telaEntrar(erro = "") {
  app.innerHTML = `<div class="main" style="justify-content:center;gap:18px">
    <div style="text-align:center"><img src="/logo.png" alt="Movivita" style="width:96px;height:96px;object-fit:contain"></div>
    <div style="text-align:center"><h1>Escala Movivita</h1><p class="sub">Entre com seu celular e seu PIN pessoal.</p></div>
    <form id="fEntrar" class="card" style="gap:14px" novalidate>
      <div class="field"><label for="cel">Celular com DDD</label><input id="cel" inputmode="tel" autocomplete="tel" placeholder="(62) 90000-0000" required></div>
      <div class="field"><label for="pin">PIN</label><input id="pin" class="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="••••" required></div>
      ${erro ? `<p class="err">${esc(erro)}</p>` : ""}
      <button class="btn prim full" type="submit">Entrar</button>
    </form>
    <p class="hint" style="text-align:center">Primeiro acesso ou esqueceu o PIN? Fale com a Coordenação.</p>
  </div>`;
  $("#fEntrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/cuidadora/entrar", { metodo: "POST", dados: { celular: $("#cel").value, pin: $("#pin").value } });
      if (r.provisorio) telaNovoPin(); else iniciar();
    } catch (err) { telaEntrar(err.message); }
  });
}

function telaNovoPin(erro = "") {
  app.innerHTML = `<div class="main" style="justify-content:center;gap:18px">
    <div><h1>Crie seu PIN pessoal</h1><p class="sub">Ele substitui o PIN provisório que você recebeu. Use de 4 a 6 números fáceis de lembrar e que só você saiba.</p></div>
    <form id="fPin" class="card" style="gap:14px" novalidate>
      <div class="field"><label for="p1">Novo PIN</label><input id="p1" class="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="p2">Repita o PIN</label><input id="p2" class="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      ${erro ? `<p class="err">${esc(erro)}</p>` : ""}
      <button class="btn prim full" type="submit">Salvar PIN</button>
    </form></div>`;
  $("#fPin").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#p1").value !== $("#p2").value) return telaNovoPin("Os dois PINs não são iguais.");
    try {
      await api("/cuidadora/novo-pin", { metodo: "POST", dados: { pin: $("#p1").value } });
      toast("PIN criado. Agora é só usar ele para entrar.");
      iniciar();
    } catch (err) { telaNovoPin(err.message); }
  });
}

// ---------- telas ----------
function cartaoConvite(p) {
  const cfg = dados.config;
  const aberta = p.status === "aberta", novo = p.status === "novoaceite";
  return `<article class="card invite">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span class="fam">${esc(p.familia)}</span>
      ${aberta ? pill("aberta", "Oferta aberta às habilitadas") : novo ? pill("novoaceite", "Plantão alterado") : pill("convite", "Convite para você")}
    </div>
    <div class="when">${dt(p.data)} • ${faixa(p.hora, p.duracao)}</div>
    <div class="meta"><span>${p.duracao} horas</span>${p.bairro ? `<span>${esc(p.bairro)}</span>` : ""}${cfg.mostrarValor && p.valor != null ? `<span>Valor: ${brl(p.valor)}</span>` : ""}${p.prazo ? `<span>Responder até ${dataHora(p.prazo)}</span>` : ""}</div>
    ${novo && p.antes ? `<div class="changed">Antes: ${esc(p.antes)}. Seu aceite anterior deixou de valer para a nova versão.</div>` : ""}
    ${p.bloqueio ? `<div class="changed">${esc(p.bloqueio)}. Você não pode aceitar este plantão.</div>` : ""}
    ${(p.avisos || []).map((a) => `<div class="changed">${esc(a)}.</div>`).join("")}
    ${aberta ? `<p class="hint">Este plantão foi oferecido a todas as cuidadoras habilitadas nesta família. O primeiro aceite preenche o plantão.</p>` : ""}
    <p class="free">${esc(cfg.voluntariedade)}<br><b style="font-style:normal;color:var(--ink)">${esc(cfg.compromisso)}</b></p>
    <div class="btns">
      <button class="btn no" data-act="recusar" data-id="${p.id}" type="button">Não posso</button>
      <button class="btn yes" data-act="aceitar" data-id="${p.id}" type="button" ${p.bloqueio ? "disabled" : ""}>Aceito</button>
    </div>
  </article>`;
}

function cartaoAvisos() {
  if (!dados.config.vapid) return "";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (ios && !instalado)
    return `<div class="banner info"><b>Receba avisos no iPhone</b><span>Toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra a Escala pelo novo ícone e ative os avisos.</span></div>`;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || Notification.permission === "granted") return "";
  if (Notification.permission === "denied")
    return `<div class="banner av"><b>Avisos bloqueados</b><span>Para receber convites no celular, libere as notificações deste site nas configurações do navegador.</span></div>`;
  return `<div class="banner info"><b>Receba os convites no celular</b><span>Ative os avisos para saber na hora quando houver um convite ou uma alteração.</span>
    <button class="btn prim" style="min-height:44px" data-act="avisos" type="button">Ativar avisos</button></div>`;
}

function abaConvites() {
  const c = dados.convites;
  const sem = dados.semanas.find((s) => !s.prazoPassou) || dados.semanas[0];
  const nInd = dados.indisp.filter((i) => i.data >= sem.ini && i.data <= sem.fim).length;
  const hoje = hojeSP();
  return `<div><h1>Olá, ${esc(dados.nome.split(" ")[0])}</h1><p class="sub">${c.length ? `Você tem ${c.length} ${c.length > 1 ? "convites" : "convite"} para responder.` : "Nenhum convite pendente."}</p></div>
    ${dados.lembretes.map((p) => `<div class="card" style="background:var(--lav);border-color:var(--lav2);gap:4px">
      <span class="fam">Lembrete • ${p.data === hoje ? "hoje" : "amanhã"}</span><b style="font-size:15px">${dt(p.data)} • ${faixa(p.hora, p.duracao)}</b>
      <span style="font-size:13px;color:var(--ink2)">${esc(p.familia)}${p.bairro ? " • " + esc(p.bairro) : ""}. A família conta com você.</span></div>`).join("")}
    ${cartaoAvisos()}
    <div class="card" style="background:var(--vcl);border-color:transparent;gap:6px">
      <b style="font-size:14px">Semana de ${dataCurta(sem.ini)} a ${dataCurta(sem.fim)}</b>
      <span style="font-size:13px;color:var(--ink2)">A distribuição é enviada às sextas. Se já sabe de alguma indisponibilidade, informe até segunda, ${dataCurta(sem.prazo)}.${nInd ? ` Você já marcou ${nInd} ${nInd > 1 ? "turnos" : "turno"}.` : ""}</span>
      <button class="linkbtn" style="align-self:flex-start;padding-left:0" data-aba="disp" type="button">Informar indisponibilidade</button>
    </div>
    ${c.map(cartaoConvite).join("") || `<div class="empty">Quando a Coordenação oferecer um plantão, ele aparece aqui${dados.config.vapid ? " e você recebe um aviso no celular" : ""}.</div>`}`;
}

function abaAgenda() {
  const ag = dados.agenda;
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px"><div><h1>Minha agenda</h1><p class="sub">Plantões que você aceitou.</p></div>
      <button class="linkbtn" data-act="extrato" type="button">Meu extrato</button></div>
    ${ag.length ? `<div class="card" style="padding:4px 16px">${ag.map((p) => `<div class="row">
      <div><div class="d">${dt(p.data)} • ${faixa(p.hora, p.duracao)}</div><div class="h">${esc(p.familia)} • ${p.duracao} horas</div></div>
      ${p.emAndamento ? pill("aceito", "Em andamento") : `<button class="linkbtn" data-act="imprevisto" data-id="${p.id}" type="button">Tive um imprevisto</button>`}</div>`).join("")}</div>`
    : `<div class="empty">Você não tem plantões aceitos pela frente.</div>`}
    <p class="hint">A Movivita conta com o seu compromisso com cada plantão aceito. Se um imprevisto realmente impedir o atendimento, avise por aqui assim que souber, para buscarmos outra cobertura a tempo.</p>`;
}

function abaDisp() {
  const has = (d, t) => dados.indisp.some((i) => i.data === d && i.turno === t);
  const hoje = hojeSP();
  return `<div><h1>Disponibilidade</h1><p class="sub">Marque os turnos em que você já sabe que não poderá atender. Não é preciso justificar.</p></div>
    ${dados.semanas.map((w) => `<section class="card" style="padding:12px 16px 6px;gap:4px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b style="font-size:14px">Semana de ${dataCurta(w.ini)} a ${dataCurta(w.fim)}</b>
        <span class="hint">${w.prazoPassou ? "Prazo encerrado, mas você ainda pode avisar" : `Informe até segunda, ${dataCurta(w.prazo)}`}</span></div>
      ${[0, 1, 2, 3, 4, 5, 6].map((n) => addDias(w.ini, n)).filter((d) => d >= hoje).map((d) => `<div class="row"><div class="d">${dt(d)}</div><div style="display:flex;gap:6px">
        ${["dia", "noite"].map((t) => { const m = has(d, t); return `<button class="chip" style="${m ? "background:var(--redBg);border-color:var(--red);color:var(--red)" : ""}" aria-pressed="${m}" data-act="indisp" data-d="${d}" data-t="${t}" type="button">${m ? "Indisponível • " + t : t === "dia" ? "Dia" : "Noite"}</button>`; }).join("")}
      </div></div>`).join("")}
    </section>`).join("")}
    <p class="hint">Toque em Dia ou Noite para marcar e toque de novo para desfazer. A Coordenação vê estas informações ao organizar a semana.</p>`;
}

function abaFamilias() {
  return `<div><h1>Famílias</h1><p class="sub">Cobertura das próximas duas semanas nas famílias em que você está habilitada. Somente leitura.</p></div>
    ${dados.familias.map((f) => `<section class="card" style="padding:6px 16px 4px"><div class="fam" style="padding-top:10px">${esc(f.apelido)}${f.bairro ? " • " + esc(f.bairro) : ""}</div>
      ${f.plantoes.map((p) => `<div class="row"><div><div class="d">${dt(p.data)}</div><div class="h">${faixa(p.hora, p.duracao)}</div></div>
        <div class="who">${p.situacao === "coberto" ? pill("aceito", "Coberto • " + p.quem) : p.situacao === "cancelado" ? pill("cancelado") : pill("aberta", "Em aberto")}</div></div>`).join("") || `<div class="empty">Nenhum plantão programado.</div>`}
    </section>`).join("") || `<div class="empty">Você ainda não está habilitada em nenhuma família.</div>`}`;
}

function render() {
  const n = dados.convites.length;
  const corpo = { convites: abaConvites, agenda: abaAgenda, disp: abaDisp, familias: abaFamilias }[aba]();
  app.innerHTML = `<header class="top"><div class="brand"><img src="/logo.png" alt=""><div><b>MOVIVITA</b><span>Escala • ${esc(dados.nome.split(" ")[0])}</span></div></div>
    <button class="linkbtn" data-act="sair" type="button">Sair</button></header>
    <main class="main">${corpo}</main>
    <nav class="tabs" role="tablist">
      ${[["convites", "Convites"], ["agenda", "Agenda"], ["disp", "Disponibilidade"], ["familias", "Famílias"]].map(([k, t]) =>
        `<button class="tab" role="tab" aria-selected="${aba === k}" data-aba="${k}" type="button">${t}${k === "convites" && n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}
    </nav>`;
}

// ---------- ações ----------
async function executar(fn) {
  if (ocupado) return;
  ocupado = true;
  try { await fn(); }
  catch (e) { if (e.status === 401) telaEntrar(); else toast(e.message); }
  finally { ocupado = false; }
}

function folhaImprevisto(id) {
  const p = dados.agenda.find((x) => x.id === id);
  const h = (new Date(p.inicio) - Date.now()) / 3600e3;
  abrirFolha(`<h3>Informar imprevisto</h3>
    <p class="sub">${esc(p.familia)} • ${dt(p.data)} • ${faixa(p.hora, p.duracao)}</p>
    <p style="margin:0">Você aceitou este plantão, e a família conta com esse atendimento. Se um imprevisto realmente impede você de comparecer, avise agora. A Coordenação é notificada e vai buscar outra cobertura para preservar a continuidade do cuidado.</p>
    ${h < 24 ? `<div class="warn">Faltam menos de 24 horas para o início. Depois de informar aqui, ligue também para a Coordenação.</div>` : ""}
    <div class="field"><label for="relato">O que aconteceu? (opcional)</label><input id="relato" maxlength="300" placeholder="Ex.: problema de saúde na família"></div>
    <button class="btn prim full" data-act="confirmarImprevisto" data-id="${id}" type="button">Informar à Coordenação</button>
    <button class="btn ghost full" data-act="fechar" type="button">Voltar, vou manter o plantão</button>`);
}

async function folhaExtrato(mes) {
  const hoje = hojeSP();
  const meses = [0, 1, 2].map((k) => { const d = new Date(hoje.slice(0, 7) + "-15T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
  mes = mes || meses[0];
  const ini = mes + "-01";
  const f = new Date(ini + "T12:00:00Z"); f.setUTCMonth(f.getUTCMonth() + 1); f.setUTCDate(0);
  const fim = f.toISOString().slice(0, 10);
  const nomeMes = (m) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-15T12:00:00Z"));
  const folha = abrirFolha(`<h3>Meu extrato</h3>
    <div class="field"><label for="mes">Mês</label><select id="mes">${meses.map((m) => `<option value="${m}" ${m === mes ? "selected" : ""}>${nomeMes(m)}</option>`).join("")}</select></div>
    <div id="doc">${carregando()}</div>
    <button class="btn prim full" data-act="pdf" type="button" disabled>Baixar PDF</button>
    <button class="btn ghost full" data-act="fechar" type="button">Fechar</button>`);
  $("#mes", folha).addEventListener("change", (e) => folhaExtrato(e.target.value));
  try {
    const ex = await api(`/eu/extrato?ini=${ini}&fim=${fim}`);
    $("#doc", folha).innerHTML = htmlExtrato(ex);
    const b = $("[data-act=pdf]", folha);
    b.disabled = false;
    b.onclick = () => baixarPDF(ex).catch(() => toast("Não foi possível gerar o PDF."));
  } catch (e) { $("#doc", folha).innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

function chaveVapid(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function inscreverAvisos() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid(dados.config.vapid) });
  await api("/push/inscrever", { metodo: "POST", dados: sub.toJSON() });
}

async function ativarAvisos() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return toast("Este navegador não recebe avisos. Tente pelo Chrome ou, no iPhone, pelo ícone na tela de início.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { render(); return toast("Os avisos não foram autorizados."); }
  await inscreverAvisos();
  render();
  toast("Avisos ativados neste celular.");
}

function sincronizarAvisos() {
  if (dados?.config.vapid && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator)
    inscreverAvisos().catch(() => {});
}

app.addEventListener("click", tratarClique);
document.addEventListener("click", (e) => { if (e.target.closest("#folha")) tratarClique(e); });

function tratarClique(e) {
  const t = e.target.closest("[data-act],[data-aba]");
  if (!t) return;
  if (t.dataset.aba) { aba = t.dataset.aba; render(); window.scrollTo(0, 0); return; }
  const id = Number(t.dataset.id);
  switch (t.dataset.act) {
    case "recarregar": return iniciar();
    case "fechar": return fecharFolha();
    case "sair": return executar(async () => { await api("/sair", { metodo: "POST" }); dados = null; telaEntrar(); });
    case "aceitar": return executar(async () => { const r = await api(`/convites/${id}/aceitar`, { metodo: "POST" }); toast(r.mensagem); await recarregar(); });
    case "recusar": return executar(async () => { const r = await api(`/convites/${id}/recusar`, { metodo: "POST" }); toast(r.mensagem); await recarregar(); });
    case "imprevisto": return folhaImprevisto(id);
    case "confirmarImprevisto": return executar(async () => {
      const r = await api(`/plantoes/${id}/imprevisto`, { metodo: "POST", dados: { relato: $("#relato")?.value || "" } });
      fecharFolha(); toast(r.mensagem); await recarregar();
    });
    case "indisp": return executar(async () => {
      const marcar = t.getAttribute("aria-pressed") !== "true";
      const r = await api("/indisponibilidade", { metodo: "POST", dados: { data: t.dataset.d, turno: t.dataset.t, marcar } });
      toast(r.mensagem); await recarregar();
    });
    case "extrato": return folhaExtrato();
    case "avisos": return executar(ativarAvisos);
  }
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && dados && !$("#folha")) recarregar(); });

iniciar();
