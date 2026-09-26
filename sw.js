// Service worker: recebe as notificações de convites, alterações e lembretes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: "Escala Movivita", corpo: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "Escala Movivita", {
      body: d.corpo || "",
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      data: { url: d.url || "/" },
      lang: "pt-BR",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      const aberta = lista.find((c) => new URL(c.url).pathname === "/");
      if (aberta) { aberta.focus(); return aberta.navigate(url); }
      return self.clients.openWindow(url);
    })
  );
});
