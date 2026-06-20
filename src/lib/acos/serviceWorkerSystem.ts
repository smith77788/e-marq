/**
 * Smart Service Worker System — офлайн підтримка.
 *
 * Функції:
 * 1. Кешування статичних ресурсів
 * 2. Офлайн fallback
 * 3. Push notifications
 * 4. Background sync
 */

export const CACHE_NAME = "marq-v1";
export const STATIC_ASSETS = [
  "/",
  "/login",
  "/signup",
  "/manifest.json",
];

/**
 * Встановити Service Worker.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

/**
 * Генерувати файл Service Worker.
 */
export function generateServiceWorkerScript(): string {
  return `
    const CACHE_NAME = "${CACHE_NAME}";
    const STATIC_ASSETS = ${JSON.stringify(STATIC_ASSETS)};

    self.addEventListener("install", (event) => {
      event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll(STATIC_ASSETS);
        })
      );
    });

    self.addEventListener("fetch", (event) => {
      event.respondWith(
        caches.match(event.request).then((response) => {
          return response || fetch(event.request);
        })
      );
    });

    self.addEventListener("push", (event) => {
      const data = event.data.json();
      event.waitUntil(
        self.registration.showNotification(data.title, {
          body: data.body,
          icon: "/favicon.ico",
        })
      );
    });
  `;
}
