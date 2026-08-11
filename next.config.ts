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
  /**
   * Empacota a app com so o que ela usa em `.next/standalone`, incluindo um
   * `server.js` proprio. E o que permite a imagem do EasyPanel nao carregar o
   * `node_modules` inteiro (centenas de MB de dependencia de build que nunca
   * rodam em producao).
   *
   * ⚠️ O standalone NAO copia `.next/static` nem `public/` — o Dockerfile faz
   * isso a mao. Esquecer resulta numa app que sobe, responde, e serve HTML sem
   * CSS nem imagem: parece rede, e e build.
   */
  output: "standalone",

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
