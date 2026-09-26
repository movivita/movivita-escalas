import webpush from "web-push";
import { q } from "./db.mjs";

let configurado = null;

function configurar() {
  if (configurado !== null) return configurado;
  const pub = Netlify.env.get("VAPID_PUBLIC_KEY");
  const priv = Netlify.env.get("VAPID_PRIVATE_KEY");
  const assunto = Netlify.env.get("VAPID_SUBJECT") || "mailto:contato@movivita.com.br";
  if (!pub || !priv) return (configurado = false);
  webpush.setVapidDetails(assunto, pub, priv);
  return (configurado = true);
}

export function chavePublica() {
  return Netlify.env.get("VAPID_PUBLIC_KEY") || null;
}

// Envia uma notificação a cada cuidadora. Falhas não interrompem a operação principal.
export async function avisar(cuidadoraIds, titulo, corpo, url = "/") {
  if (!configurar() || !cuidadoraIds.length) return;
  const inscricoes = await q("SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE cuidadora_id = ANY($1)", [[...new Set(cuidadoraIds)]]);
  const payload = JSON.stringify({ titulo, corpo, url });
  await Promise.all(
    inscricoes.map(async (i) => {
      try {
        await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, payload, { TTL: 86400 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await q("DELETE FROM push_inscricoes WHERE endpoint=$1", [i.endpoint]);
        else console.error("Falha no envio de notificação", e.statusCode || e.message);
      }
    })
  );
}
