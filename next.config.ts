import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Raiz explicita. Sem isso o Turbopack sobe a arvore procurando lockfile,
    // acha um no diretorio home do dev (C:\Users\<nome>) e emite warning em
    // todo build. Cravar aqui torna a raiz deterministica em qualquer maquina.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
