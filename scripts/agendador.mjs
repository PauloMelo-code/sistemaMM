#!/usr/bin/env node
/**
 * Agendador: chama o worker e a reconciliacao em intervalo fixo.
 *
 * Roda como um SEGUNDO servico no EasyPanel, a partir da MESMA imagem da
 * aplicacao — mesma build, mesmas variaveis, so o comando de inicio muda:
 *
 *   node scripts/agendador.mjs
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ISTO NAO FECHA O ADR DE ONDE O WORKER RODA, e a diferenca importa.
 *
 * Este processo NAO drena a fila: ele so bate na rota HTTP que ja existe. Quem
 * drena continua sendo a aplicacao, com o codigo que ja esta testado. Trocar
 * este agendador por cron do sistema, por um agendador de plataforma ou por
 * BullMQ e trocar UM arquivo — a rota continua sendo a costura.
 *
 * Se em vez disso ele importasse `drenarEventos` e rodasse em processo, a
 * escolha estaria feita: o worker passaria a viver aqui, e o ADR do Lucas
 * (fila em Postgres x Redis) teria sido decidido por acidente, num script de
 * infraestrutura. Nao e assim que decisao de arquitetura se toma.
 * ---------------------------------------------------------------------------
 *
 * POR QUE UM SEGUNDO SERVICO E NAO UM CRON: esta instalacao do EasyPanel nao
 * tem agendamento por servico. Um processo proprio custa pouco (fica dormindo
 * quase o tempo todo) e aparece na lista de servicos — o que ja e mais do que
 * um cron escondido no host oferece a quem for investigar por que a fila parou.
 */
import { env, exit } from "node:process";

/**
 * Onde a aplicacao atende. Como este processo e OUTRO container, `127.0.0.1`
 * nao serve: precisa do nome do servico na rede interna do EasyPanel
 * (ex.: `http://sistema_sistemamm:3000`).
 */
const BASE = (env.APP_URL || "").replace(/\/+$/, "");
const SEGREDO = env.WEBHOOK_SECRET;

/** A cada minuto. A fila e o que separa "vendido" de "anuncio ainda no ar". */
const INTERVALO_WORKER_MS = 60_000;
/** A cada 15 min: rede de seguranca para webhook que se perdeu. Mais cara. */
const INTERVALO_RECONCILIACAO_MS = 15 * 60_000;

if (!BASE || !SEGREDO) {
  // Falha FECHADA e barulhenta. Um agendador que sobe "com sucesso" e nunca
  // chama nada e o pior estado possivel: a fila para, e o painel do EasyPanel
  // mostra o servico verde.
  console.error("[agendador] faltando configuracao — nao vou subir.");
  if (!BASE) console.error("  APP_URL (ex.: http://sistema_sistemamm:3000)");
  if (!SEGREDO) console.error("  WEBHOOK_SECRET (o mesmo da aplicacao)");
  exit(1);
}

const agora = () => new Date().toISOString().slice(11, 19);

/** Ultima vez que cada erro repetido foi registrado. Ver o uso em `bater`. */
const repetidos = new Map();

/**
 * Houve trabalho de verdade nesta passada?
 *
 * A resposta do worker traz dois blocos (`eventos` e `tarefas`) com contadores.
 * Contador de ESTADO — `aguardandoHandler`, `aguardandoExecutor` — nao conta:
 * ele descreve a fila parada esperando credencial, e sai igual toda vez. O que
 * merece uma linha e o que ACONTECEU.
 */
function houveTrabalho(corpo) {
  const aconteceu = ["processados", "falhados", "esgotados", "ignorados", "executadas", "falhadas", "esgotadas", "ignoradas"];
  return Object.values(corpo).some(
    (bloco) =>
      bloco && typeof bloco === "object" && aconteceu.some((chave) => Number(bloco[chave]) > 0),
  );
}

/**
 * Uma batida. NUNCA lanca: erro aqui e transitorio (deploy em andamento, banco
 * reiniciando) e nao pode derrubar o agendador — se derrubasse, uma falha de 5
 * segundos pararia a fila ate alguem perceber.
 */
async function bater(rota) {
  try {
    const resposta = await fetch(`${BASE}/api/integracoes/${rota}?t=${encodeURIComponent(SEGREDO)}`, {
      method: "POST",
      // Teto de tempo: sem ele, uma resposta que nunca chega prende a proxima
      // batida para sempre (ver o laco abaixo, que espera antes de reagendar).
      signal: AbortSignal.timeout(120_000),
    });

    const corpo = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      // 404 aqui quase sempre significa segredo errado — a rota se esconde de
      // quem varre a internet em vez de responder 401. Vale dizer isso, senao
      // o log vira "404" sem pista.
      const pista = resposta.status === 404 ? " (segredo errado?)" : "";
      const motivo = corpo?.erro ? ` ${corpo.erro}` : "";

      /**
       * ERRO REPETIDO SO APARECE UMA VEZ POR HORA.
       *
       * Enquanto o Mercado Livre nao for conectado, a reconciliacao devolve 500
       * com "Sem credencial" a CADA 15 MINUTOS. Repetir isso para sempre e como
       * nao registrar nada: quem le o log aprende a rolar por cima, e no dia em
       * que aparecer um erro DIFERENTE ninguem vai ver. Erro novo sai na hora;
       * o mesmo erro de novo espera uma hora.
       */
      const chave = `${rota}:${resposta.status}:${corpo?.erro ?? ""}`;
      const visto = repetidos.get(chave) ?? 0;
      if (Date.now() - visto > 3_600_000) {
        repetidos.set(chave, Date.now());
        console.error(`[agendador ${agora()}] ${rota}: HTTP ${resposta.status}${pista}${motivo}`);
      }
      return;
    }

    // Sucesso: so registra quando houve TRABALHO. Uma linha de "nada a fazer"
    // por minuto sao 1.440 por dia, e elas enterram a linha que importa.
    if (corpo && houveTrabalho(corpo)) {
      console.log(`[agendador ${agora()}] ${rota}: ${JSON.stringify(corpo)}`);
    }
  } catch (erro) {
    console.error(`[agendador ${agora()}] ${rota} falhou: ${erro.message}`);
  }
}

/**
 * Laco que ESPERA a batida terminar antes de agendar a proxima.
 *
 * Com `setInterval` puro, uma drenagem lenta acumularia chamadas sobrepostas —
 * e o worker reivindica com `FOR UPDATE SKIP LOCKED`, entao elas nao se
 * corrompem, mas competem por conexao do pool sem necessidade.
 */
function agendar(rota, intervalo) {
  const repetir = async () => {
    await bater(rota);
    // ⚠️ SEM `.unref()` aqui. Um timer "unref" nao segura o event loop: o
    // processo terminaria logo apos a primeira batida, o container sairia com
    // codigo 0 e o EasyPanel mostraria "parou sozinho, sem erro". Este processo
    // EXISTE para nao terminar.
    setTimeout(repetir, intervalo);
  };
  repetir();
}

console.log(`[agendador] worker a cada ${INTERVALO_WORKER_MS / 1000}s, reconciliacao a cada ${INTERVALO_RECONCILIACAO_MS / 60_000}min`);
console.log(`[agendador] alvo: ${BASE}`);

agendar("worker", INTERVALO_WORKER_MS);
agendar("reconciliar", INTERVALO_RECONCILIACAO_MS);
