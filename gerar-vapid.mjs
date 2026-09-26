// Gera o par de chaves para as notificações no celular (web push).
// Uso: npm run vapid  e cadastre as duas chaves nas variáveis de ambiente do Netlify.
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + k.publicKey);
console.log("VAPID_PRIVATE_KEY=" + k.privateKey);
