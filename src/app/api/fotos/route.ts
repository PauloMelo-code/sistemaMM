/**
 * Fotos de item: upload, listagem, reordenacao e o toggle do site.
 *
 * ⚠️ ESTA ROTA NAO TEM AUTENTICACAO, porque o projeto ainda nao tem
 * (docs/known-issues.md 🔴). Enquanto isso, o que segura o abuso e a validacao:
 * o tipo vem do CONTEUDO (nao do `content-type` nem do nome), ha teto de bytes,
 * teto de fotos por item, e o caminho no bucket e gerado pelo servidor.
 *
 * Nada disso substitui sessao. Em producao, o dominio do painel precisa estar
 * atras do Basic Auth do EasyPanel ate a autenticacao existir — do contrario
 * qualquer um enche o bucket. Registrado em known-issues, nao escondido.
 */
import { NextResponse } from "next/server";

import {
  adicionarFoto,
  definirExibicaoNoSite,
  listarFotos,
  reordenar,
  MAXIMO_FOTOS_POR_ITEM,
} from "@/lib/actions/fotos";
import { BYTES_MAXIMO } from "@/lib/storage/imagem";

// `pg` e `node:crypto` nao rodam no runtime edge.
export const runtime = "nodejs";

/** Folga para o envelope do multipart (delimitadores e cabecalhos de parte). */
const TAMANHO_MAXIMO_UPLOAD = BYTES_MAXIMO + 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Falha de infraestrutura: o detalhe vai para o log, nao para a resposta. A
 * mensagem do storage cita nomes de variavel de ambiente, e esta rota esta
 * aberta — nao ha por que ensinar a configuracao a quem varre a internet.
 */
function falhaInterna(contexto: string, erro: unknown) {
  console.error(`[fotos] ${contexto}`, erro);
  return NextResponse.json({ erro: "falha ao processar a foto" }, { status: 500 });
}

export async function GET(request: Request) {
  const itemId = new URL(request.url).searchParams.get("item_id") ?? "";
  if (!UUID.test(itemId)) {
    return NextResponse.json({ erro: "item_id invalido" }, { status: 400 });
  }

  try {
    return NextResponse.json({ fotos: await listarFotos(itemId) });
  } catch (erro) {
    return falhaInterna("falha ao listar", erro);
  }
}

export async function POST(request: Request) {
  // `content-length` e dica, nao garantia — evita so ler um corpo grande a toa.
  // O teto real e conferido nos bytes, dentro de `analisarImagem`.
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > TAMANHO_MAXIMO_UPLOAD) {
    return NextResponse.json({ erro: "arquivo grande demais" }, { status: 413 });
  }

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return NextResponse.json({ erro: "envie multipart/form-data" }, { status: 400 });
  }

  const itemId = String(formulario.get("item_id") ?? "");
  if (!UUID.test(itemId)) {
    return NextResponse.json({ erro: "item_id invalido" }, { status: 400 });
  }

  const arquivo = formulario.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return NextResponse.json({ erro: "campo `arquivo` ausente ou vazio" }, { status: 400 });
  }
  if (arquivo.size > TAMANHO_MAXIMO_UPLOAD) {
    return NextResponse.json({ erro: "arquivo grande demais" }, { status: 413 });
  }

  const alt = formulario.get("alt");

  try {
    const resultado = await adicionarFoto({
      itemId,
      dados: Buffer.from(await arquivo.arrayBuffer()),
      alt: typeof alt === "string" && alt.trim() ? alt.trim() : null,
    });

    // `ok: false` aqui e recusa esperada (arquivo errado, item inexistente,
    // limite atingido) — o `motivo` e escrito para o operador ler na tela.
    if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 400 });

    return NextResponse.json({ ok: true, foto: resultado.dados }, { status: 201 });
  } catch (erro) {
    return falhaInterna(`falha ao enviar foto do item ${itemId}`, erro);
  }
}

/**
 * Duas operacoes de item (nao de foto): reordenar a galeria e ligar/desligar o
 * item no site. Ficam aqui, e nao em `[id]`, porque a chave das duas e o ITEM.
 */
export async function PATCH(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "corpo JSON invalido" }, { status: 400 });
  }

  const dados = (corpo ?? {}) as Record<string, unknown>;
  const itemId = String(dados.item_id ?? "");
  if (!UUID.test(itemId)) {
    return NextResponse.json({ erro: "item_id invalido" }, { status: 400 });
  }

  try {
    if (Array.isArray(dados.ordem)) {
      const ids = dados.ordem.map(String);
      if (ids.some((id) => !UUID.test(id))) {
        return NextResponse.json({ erro: "ordem contem id invalido" }, { status: 400 });
      }
      if (ids.length > MAXIMO_FOTOS_POR_ITEM) {
        return NextResponse.json({ erro: "ordem contem fotos demais" }, { status: 400 });
      }

      const resultado = await reordenar(itemId, ids);
      if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 400 });
    }

    if (typeof dados.exibir_no_site === "boolean") {
      const resultado = await definirExibicaoNoSite(itemId, dados.exibir_no_site);
      // A recusa da RN-109 (item sem foto) e o caso mais provavel aqui, e o
      // operador precisa ler o motivo — nao um 400 mudo.
      if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 400 });
    }

    return NextResponse.json({ ok: true, fotos: await listarFotos(itemId) });
  } catch (erro) {
    return falhaInterna(`falha ao atualizar item ${itemId}`, erro);
  }
}
