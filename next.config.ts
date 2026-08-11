import path from "node:path";
import type { NextConfig } from "next";

/**
 * Host do MinIO liberado para o `next/image`.
 *
 * Sem isto o componente RECUSA a URL da foto ("hostname not configured") e a
 * vitrine fica sem imagem — mesmo com o arquivo no ar e o link certo. O valor
 * sai do ambiente porque o host muda entre local, HML e PRD; cravar aqui daria
 * um build que so funciona num deles.
 *
 * Ausente ou malformado, segue sem a liberacao: o build nao pode quebrar por
 * causa de variavel de storage, e o erro aparece no lugar certo (na imagem).
 */
function hostDasFotos() {
  const bruto = process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT;
  if (!bruto) return [];

  try {
    const { protocol, hostname, port } = new URL(bruto);
    return [
      {
        protocol: protocol.replace(":", "") as "http" | "https",
        hostname,
        port,
        pathname: "/**",
      },
    ];
  } catch {
    console.warn(`[next.config] MINIO_PUBLIC_URL invalida: ${bruto}`);
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: hostDasFotos(),
  },
  turbopack: {
    // Raiz explicita. Sem isso o Turbopack sobe a arvore procurando lockfile,
    // acha um no diretorio home do dev (C:\Users\<nome>) e emite warning em
    // todo build. Cravar aqui torna a raiz deterministica em qualquer maquina.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
