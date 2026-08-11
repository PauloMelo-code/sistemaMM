import type { Metadata } from "next";
import { Archivo, Jost } from "next/font/google";
import "./globals.css";

// Archivo = display e todo numero que importa (KPI, preco, valor).
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

// Jost = texto corrido, labels, tabela.
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sistema MM Solucoes",
  description: "Painel de gestao de marketplaces da MM Solucoes Empresariais.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${jost.variable} h-full antialiased`}
    >
      {/* A fonte do corpo vem da regra `body` do globals.css, junto com o fundo
          e a cor do texto — um lugar so. Nao repita `font-body` aqui. */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
