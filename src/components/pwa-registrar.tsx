"use client";

import { useEffect } from "react";

export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }
    let refreshing = false;
    const registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    void registrationPromise.then((registration) => {
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      void registration.update();
    });
  }, []);

  return null;
}
