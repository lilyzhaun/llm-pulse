export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  if (import.meta.env.DEV) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/status/sw.js", { scope: "/status/" })
      .catch((error: unknown) => {
        console.warn("Failed to register service worker", error);
      });
  });
}
