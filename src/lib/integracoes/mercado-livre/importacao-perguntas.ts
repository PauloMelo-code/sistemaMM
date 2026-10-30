/**
 * Perguntas do Mercado Livre para a caixa unificada (RN-105, RN-117).
 *
 * Dois caminhos, uma gravacao so:
 * - **importacao** (botao na tela Perguntas): varre as perguntas da conta;
 * - **notificacao** `questions` (worker): busca a pergunta que o webhook avisou.
 *
 * SO LEITURA no ML. Responder pelo painel e outra etapa.
 *
 * `created_at` recebe a hora em que o COMPRADOR perguntou, nao a da gravacao:
 * a tela calcula o tempo de resposta a partir dela, e importar hoje uma pergunta
 * de ontem mostraria um atendimento instantaneo que nao aconteceu.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { perguntas } from "@/lib/db/schema/perguntas";
import { registrarAuditoria } from "@/lib/audit/logger";

import { chamarML, ErroML } from "./client";
import {
  idDaPergunta,
  lerPaginaPerguntas,
  lerPerguntaML,
  perguntaEncerradaNoML,
  type PerguntaML,
} from "./pergunta-ml";
import { ErroPermanente } from "../retentativa";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { EventoParaHandler } from "../handlers";

const POR_PAGINA = 50;

/**
 * Teto da importacao: as 500 perguntas mais recentes. Pergunta antiga ja
 * respondida nao e trabalho; o que importa (pendente) e sempre recente.
 */
const MAX_PAGINAS = 10;

export interface ResumoPerguntas {
  lidas: number;
  novas: number;
  atualizadas: number;
  /** Pendentes que o ML diz excluidas ou encerradas: sairam da caixa. */
  encerradas: number;
  /** Fora da caixa e que nao estavam nela (em revisao, de outra conta). */
  ignoradas: number;
  falhas: number;
}

/** Grava (ou atualiza) as perguntas. Idempotente pela chave (canal, id_externo). */
async function gravar(lista: PerguntaML[], usuarioId: string, resumo: ResumoPerguntas) {
  if (lista.length === 0) return;

  await db.transaction(async (tx) => {
    const existentes = new Set(
      (
        await tx
          .select({ id: perguntas.id_externo })
          .from(perguntas)
          .where(
            and(
              eq(perguntas.canal, "mercado_livre"),
              inArray(perguntas.id_externo, lista.map((p) => p.idExterno)),
              eq(perguntas.is_deleted, false),
            ),
          )
      ).map((l) => l.id),
    );

    for (const p of lista) {
      const dados = {
        id_anuncio_externo: p.idAnuncio,
        texto: p.texto,
        status: p.status,
        resposta: p.resposta,
        respondida_em: p.respondidaEm,
        prazo_sla: p.prazoSla,
        updated_at: new Date(),
        modified_by: usuarioId,
      };

      // `item_id` fica fora do `set`: o vinculo e feito em outro lugar e
      // reimportar nao pode desfaze-lo.
      const [linha] = await tx
        .insert(perguntas)
        .values({ canal: "mercado_livre", id_externo: p.idExterno, created_at: p.feitaEm, ...dados })
        .onConflictDoUpdate({
          target: [perguntas.canal, perguntas.id_externo],
          targetWhere: sql`${perguntas.is_deleted} = false`,
          set: dados,
        })
        .returning({ id: perguntas.id });

      const nova = !existentes.has(p.idExterno);
      if (nova) resumo.novas += 1;
      else resumo.atualizadas += 1;

      await registrarAuditoria(tx, {
        userId: usuarioId,
        acao: nova ? "criar" : "atualizar",
        tabela: "perguntas",
        registroId: linha.id,
        detalhes:
          `${nova ? "Trouxe" : "Atualizou"} do Mercado Livre a pergunta ${p.idExterno} ` +
          `do anuncio ${p.idAnuncio} (${p.status})`,
      });
    }
  });
}

/**
 * Tira da caixa as PENDENTES que o ML diz estarem encerradas. Exclusao logica,
 * com trilha. Respondida fica: e historico de atendimento, nao trabalho.
 */
async function encerrar(ids: string[], usuarioId: string, resumo: ResumoPerguntas) {
  if (ids.length === 0) return;

  await db.transaction(async (tx) => {
    const fechadas = await tx
      .update(perguntas)
      .set({ is_deleted: true, deleted_at: new Date(), updated_at: new Date(), modified_by: usuarioId })
      .where(
        and(
          eq(perguntas.canal, "mercado_livre"),
          inArray(perguntas.id_externo, ids),
          eq(perguntas.status, "pendente"),
          eq(perguntas.is_deleted, false),
        ),
      )
      .returning({ id: perguntas.id, idExterno: perguntas.id_externo });

    for (const f of fechadas) {
      resumo.encerradas += 1;
      await registrarAuditoria(tx, {
        userId: usuarioId,
        acao: "excluir",
        tabela: "perguntas",
        registroId: f.id,
        detalhes: `Tirou da caixa a pergunta ${f.idExterno}: excluida ou encerrada no Mercado Livre`,
      });
    }
  });
}

/**
 * As pendentes da caixa que a busca NAO devolveu. Pergunta excluida pelo
 * comprador some da busca do ML, entao so perguntando uma a uma se sabe se ela
 * ainda existe. Sao poucas (so as pendentes), e a chamada e por id.
 */
async function conferirPendentesSumidas(
  vistas: ReadonlySet<string>,
  vendedor: string,
  usuarioId: string,
  resumo: ResumoPerguntas,
) {
  const pendentes = await db
    .select({ idExterno: perguntas.id_externo })
    .from(perguntas)
    .where(
      and(
        eq(perguntas.canal, "mercado_livre"),
        eq(perguntas.status, "pendente"),
        eq(perguntas.is_deleted, false),
      ),
    );

  const encerradas: string[] = [];
  const atualizadas: PerguntaML[] = [];

  for (const { idExterno } of pendentes) {
    if (!idExterno || vistas.has(idExterno)) continue;
    let bruta: unknown;
    try {
      bruta = await chamarML(`/questions/${idExterno}?api_version=4`);
    } catch (erro) {
      // 404: o ML nao conhece mais a pergunta — excluida.
      if (erro instanceof ErroML && erro.status === 404) encerradas.push(idExterno);
      else resumo.falhas += 1;
      continue;
    }
    if (perguntaEncerradaNoML(bruta)) {
      encerradas.push(idExterno);
      continue;
    }
    const p = lerPerguntaML(bruta);
    if (p && (!p.idVendedor || p.idVendedor === vendedor)) atualizadas.push(p);
  }

  await gravar(atualizadas, usuarioId, resumo);
  await encerrar(encerradas, usuarioId, resumo);
}

/** Importa as perguntas da conta conectada. Lanca se o ML falhar. */
export async function importarPerguntasML(usuarioId: string): Promise<ResumoPerguntas> {
  const resumo: ResumoPerguntas = {
    lidas: 0, novas: 0, atualizadas: 0, encerradas: 0, ignoradas: 0, falhas: 0,
  };

  const { id } = await chamarML<{ id: number | string }>("/users/me");
  const vendedor = String(id);
  const lidas: PerguntaML[] = [];
  const encerradas: string[] = [];
  const vistas = new Set<string>();

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const busca = new URLSearchParams({
      seller_id: vendedor,
      api_version: "4",
      limit: String(POR_PAGINA),
      offset: String(pagina * POR_PAGINA),
      sort_fields: "date_created",
      sort_types: "DESC",
    });
    const { perguntas: brutas, total } = lerPaginaPerguntas(
      await chamarML(`/questions/search?${busca}`),
    );

    for (const bruta of brutas) {
      resumo.lidas += 1;
      const idCru = idDaPergunta(bruta);
      if (idCru) vistas.add(idCru);
      try {
        if (idCru && perguntaEncerradaNoML(bruta)) {
          encerradas.push(idCru);
          continue;
        }
        const p = lerPerguntaML(bruta);
        if (!p || (p.idVendedor && p.idVendedor !== vendedor)) resumo.ignoradas += 1;
        else lidas.push(p);
      } catch (erro) {
        resumo.falhas += 1;
        console.warn("[perguntas-ml] pergunta em formato inesperado", erro);
      }
    }

    if (brutas.length < POR_PAGINA || (pagina + 1) * POR_PAGINA >= total) break;
  }

  await gravar(lidas, usuarioId, resumo);
  await encerrar(encerradas, usuarioId, resumo);
  await conferirPendentesSumidas(vistas, vendedor, usuarioId, resumo);
  return resumo;
}

/**
 * Handler da notificacao `questions`. Busca a pergunta na API (RN-117) e grava.
 * Lane `urgente`: pergunta tem SLA de 4h correndo.
 */
export async function handlerPerguntaML(evento: EventoParaHandler): Promise<void> {
  if (!evento.recurso) {
    throw new ErroPermanente("Notificacao de pergunta sem `recurso` — nao ha o que buscar.");
  }

  const resumo: ResumoPerguntas = {
    lidas: 1, novas: 0, atualizadas: 0, encerradas: 0, ignoradas: 0, falhas: 0,
  };
  const separador = evento.recurso.includes("?") ? "&" : "?";
  const bruta = await chamarML(`${evento.recurso}${separador}api_version=4`, { lane: "urgente" });

  // Excluida ou encerrada: se ja estava na caixa como pendente, sai dela.
  const idCru = idDaPergunta(bruta);
  if (idCru && perguntaEncerradaNoML(bruta)) {
    await encerrar([idCru], USUARIO_SISTEMA_ID, resumo);
    return;
  }

  const p = lerPerguntaML(bruta);
  if (!p) return; // em revisao: passageiro, nada a fazer agora

  const { id } = await chamarML<{ id: number | string }>("/users/me", { lane: "urgente" });
  if (p.idVendedor && p.idVendedor !== String(id)) {
    throw new ErroPermanente(`Pergunta ${p.idExterno} e de outro vendedor (${p.idVendedor}).`);
  }

  await gravar([p], USUARIO_SISTEMA_ID, resumo);
}
