import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Temaria · Estudio SSCS0208",
    short_name: "Temaria",
    description:
      "Biblioteca, práctica y tutor fundamentado para estudiar los módulos SSCS0208.",
    start_url: "/aula",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#111827",
    orientation: "any",
    lang: "es",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
