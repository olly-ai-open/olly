const body = `self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Olly";
  const options = {
    body: data.body || "A brief is ready.",
    tag: data.tag || "olly-brief",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
        return undefined;
      }),
  );
});
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "application/javascript",
      "cache-control": "no-store, max-age=0",
    },
  });
}
