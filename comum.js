// Funções compartilhadas entre a tela da cuidadora e o painel da Coordenação.

export const $ = (s, el = document) => el.querySelector(s);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function api(caminho, { metodo = "GET", dados } = {}) {
  const opcoes = { method: metodo, credentials: "same-origin", headers: {} };
  if (metodo !== "GET") {
    opcoes.headers["content-type"] = "application/json";
    opcoes.body = JSON.stringify(dados ?? {});
  }
  let r;
  try {
    r = await fetch("/api" + caminho, opcoes);
  } catch {
    throw Object.assign(new Error("Sem conexão. Verifique a internet e tente de novo."), { status: 0 });
  }
  let j = {};
  try { j = await r.json(); } catch { /* resposta vazia */ }
  if (!r.ok) throw Object.assign(new Error(j.erro || "Não foi possível concluir."), { status: r.status });
  return j;
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n) => String(n).padStart(2, "0");

export const dataCurta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const dt = (d) => `${DIAS[new Date(d + "T12:00:00Z").getUTCDay()]}, ${dataCurta(d)}`;
export const faixa = (h, dur) => `${pad(h)}h às ${pad((h + dur) % 24)}h`;
export const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const addDias = (d, n) => {
  const x = new Date(d + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const segundaDe = (d) => {
  const dow = new Date(d + "T12:00:00Z").getUTCDay();
  return addDias(d, dow === 0 ? -6 : 1 - dow);
};
export function dataHora(iso) {
  if (!iso) return "";
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t) => f.find((p) => p.type === t)?.value;
  return `${g("day")}/${g("month")} às ${g("hour")}:${g("minute")}`;
}

export const ROTULO = {
  rascunho: "Rascunho", convite: "Convite enviado", aberta: "Oferta aberta", aceito: "Aceito",
  aguardando: "Aguardando Coordenação", novoaceite: "Novo aceite necessário", cancelado: "Cancelado",
  conferencia: "Aguardando conferência", realizado: "Realizado", naorealizado: "Não realizado",
};
export const pill = (st, texto) => `<span class="pill s-${st}">${esc(texto || ROTULO[st] || st)}</span>`;

let tempoToast;
export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => (el.hidden = true), 3600);
}

export function abrirFolha(html) {
  fecharFolha();
  const d = document.createElement("div");
  d.className = "scrim";
  d.id = "folha";
  d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  d.addEventListener("click", (e) => { if (e.target === d) fecharFolha(); });
  document.body.appendChild(d);
  const foco = d.querySelector("input,select,textarea,button");
  foco?.focus({ preventScroll: true });
  return d.firstElementChild;
}
export function fecharFolha() {
  $("#folha")?.remove();
}

export const carregando = () => `<div class="spin" role="status" aria-label="Carregando"></div>`;

// ---------- Extrato ----------
const SITUACAO = (i) =>
  i.status === "realizado" ? "Realizado" :
  i.status === "conferencia" ? "Aguardando conferência" :
  i.status === "naorealizado" ? `Não realizado${i.motivo ? " (" + i.motivo + ")" : ""}` :
  i.emAndamento ? "Em andamento" : "Aceito, a realizar";

function linhasExtrato(ex) {
  const porCuid = ex.tipo === "cuid";
  const linhas = ex.itens.map((i) => ({
    chave: i.data + pad(i.hora),
    cols: [dataCurta(i.data), faixa(i.hora, i.duracao), porCuid ? i.familia : i.cuidadora, `${i.duracao}h`, SITUACAO(i),
      ...(porCuid ? [i.aceiteEm ? dataHora(i.aceiteEm) : "", ex.comValor && i.status === "realizado" && i.valor != null ? brl(i.valor) : ""] : [])],
  }));
  for (const m of ex.imprevistos || [])
    linhas.push({ chave: m.data + pad(m.hora), cols: [dataCurta(m.data), faixa(m.hora, m.duracao), m.familia, "0h", `Imprevisto comunicado ${m.horas_antes}h antes`, "", ""] });
  return linhas.sort((a, b) => a.chave.localeCompare(b.chave)).map((l) => l.cols);
}

function cabecalho(ex) {
  const porCuid = ex.tipo === "cuid";
  return ["Data", "Horário", porCuid ? "Família" : "Cuidadora", "Horas", "Situação", ...(porCuid ? ["Aceite", "Valor"] : [])];
}

export function htmlExtrato(ex) {
  const linhas = linhasExtrato(ex);
  const t = ex.totais;
  return `<div class="paper">
    <div class="ph"><div><h4>Extrato de plantões</h4><div class="pm">${esc(ex.titulo)}<br>Período: ${dataCurta(ex.ini)}/${ex.ini.slice(0, 4)} a ${dataCurta(ex.fim)}/${ex.fim.slice(0, 4)}<br>${ex.fechado ? "Período fechado e conferido" : "Período em aberto, sujeito a conferência"}</div></div><img src="/logo.png" alt="Movivita"></div>
    <div class="tw"><table><thead><tr>${cabecalho(ex).map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="7">Nenhum plantão no período.</td></tr>`}</tbody></table></div>
    <div class="tot"><div><b>${t.realizados}</b>plantões realizados</div><div><b>${t.horas}h</b>horas realizadas</div>${t.valor != null ? `<div><b>${brl(t.valor)}</b>valor realizado</div>` : `<div><b>${t.plantoes}</b>plantões no período</div>`}</div>
    ${t.pendentes ? `<div class="pm">${t.pendentes} ${t.pendentes > 1 ? "plantões aguardam" : "plantão aguarda"} conferência e não ${t.pendentes > 1 ? "entram" : "entra"} nos totais.</div>` : ""}
    <div class="pf">Emitido em ${dataHora(ex.emitidoEm)} por ${esc(ex.emissor)} • Código de verificação ${esc(ex.codigo)}<br>Movivita • Cuidar é manter a vida em movimento</div>
  </div>`;
}

async function logoDataURL() {
  const b = await (await fetch("/logo.png")).blob();
  return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
}

export async function baixarPDF(ex) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const L = 40, W = doc.internal.pageSize.getWidth();
  const roxo = [75, 63, 209], cinza = [92, 90, 110];
  try { doc.addImage(await logoDataURL(), "PNG", W - L - 48, 30, 48, 48); } catch { /* segue sem logo */ }
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...roxo).text("Extrato de plantões", L, 50);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...cinza);
  doc.text(ex.titulo, L, 66);
  doc.text(`Período: ${dataCurta(ex.ini)}/${ex.ini.slice(0, 4)} a ${dataCurta(ex.fim)}/${ex.fim.slice(0, 4)}`, L, 79);
  doc.text(ex.fechado ? "Período fechado e conferido" : "Período em aberto, sujeito a conferência", L, 92);
  doc.setDrawColor(...roxo).setLineWidth(1.5).line(L, 102, W - L, 102);
  doc.autoTable({
    startY: 112, head: [cabecalho(ex)], body: linhasExtrato(ex), margin: { left: L, right: L },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: [31, 29, 43] },
    headStyles: { fillColor: roxo, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 247, 250] },
  });
  let y = doc.lastAutoTable.finalY + 20;
  const t = ex.totais;
  doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...roxo);
  doc.text(`${t.realizados} plantões realizados   •   ${t.horas} horas realizadas${t.valor != null ? `   •   ${brl(t.valor)}` : ""}`, L, y);
  if (t.pendentes) { y += 14; doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...cinza).text(t.pendentes > 1 ? `${t.pendentes} plantões aguardam conferência e não entram nos totais.` : "1 plantão aguarda conferência e não entra nos totais.", L, y); }
  const H = doc.internal.pageSize.getHeight();
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...cinza);
    doc.text(`Emitido em ${dataHora(ex.emitidoEm)} por ${ex.emissor}  •  Código de verificação ${ex.codigo}  •  Página ${i} de ${paginas}`, L, H - 28);
    doc.text("Movivita • Cuidar é manter a vida em movimento", L, H - 16);
  }
  const slug = ex.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  doc.save(`extrato-${slug}-${ex.ini}-a-${ex.fim}.pdf`);
}
