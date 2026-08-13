import type { Metadata } from "next";

import { PwaRegistrar } from "@/components/pwa-registrar";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Temaria | Estudio SSCS0208",
    template: "%s | Temaria",
  },
  description:
    "Plataforma privada para estudiar SSCS0208 con biblioteca, evaluaciones, práctica, analíticas y tutor con respuestas fundamentadas.",
  applicationName: "Temaria",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Temaria",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aula-theme');var d=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Saltar al contenido
        </a>
        {children}
        <PwaRegistrar />
      </body>
    </html>
  );
}
