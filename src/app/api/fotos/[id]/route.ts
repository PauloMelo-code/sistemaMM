/**
 * Operacoes sobre UMA foto: definir como capa, editar o texto alternativo e
 * excluir.
 *
 * ⚠️ Sem autenticacao, pelo mesmo motivo da rota irma — ver o cabecalho de
 * `../route.ts`.
 */
import { NextResponse } from "next/server";

import { definirAlt, definirPrincipal, removerFoto } from "@/lib/actions/fotos";

// `pg` nao roda no runtime edge.
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Limite generoso: e legenda de foto, nao descricao de produto. */
const ALT_MAXIMO = 300;

function falhaInterna(contexto: string, erro: unknown) {
  console.error(`[fotos] ${contexto}`, erro);
  return NextResponse.json({ erro: "falha ao processar a foto" }, { status: 500 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ erro: "id invalido" }, { status: 400 });

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "corpo JSON invalido" }, { status: 400 });
  }

  const dados = (corpo ?? {}) as Record<string, unknown>;

  try {
    if (dados.principal === true) {
      const resultado = await definirPrincipal(id);
      if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 404 });
    }

    if ("alt" in dados) {
      const bruto = dados.alt;
      if (bruto !== null && typeof bruto !== "string") {
        return NextResponse.json({ erro: "alt deve ser texto ou null" }, { status: 400 });
      }
      const alt = typeof bruto === "string" ? bruto.trim().slice(0, ALT_MAXIMO) : null;

      const resultado = await definirAlt(id, alt || null);
      if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falhaInterna(`falha ao atualizar foto ${id}`, erro);
  }
}

/**
 * Exclusao LOGICA. O arquivo continua no MinIO — e o que permite voltar atras de
 * um clique errado. Se a foto era a capa, outra assume automaticamente, e o id
 * dela volta na resposta para a tela nao precisar recarregar tudo.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ erro: "id invalido" }, { status: 400 });

  try {
    const resultado = await removerFoto(id);
    if (!resultado.ok) return NextResponse.json({ erro: resultado.motivo }, { status: 404 });

    return NextResponse.json({ ok: true, novaCapa: resultado.dados.novaCapa });
  } catch (erro) {
    return falhaInterna(`falha ao excluir foto ${id}`, erro);
  }
}
