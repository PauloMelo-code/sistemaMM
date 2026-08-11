/**
 * A faixa de alerta da tela Integracoes — o estado que o prototipo nao desenhou.
 *
 * A auditoria registrou como defeito principal desta tela: "o estado de erro — o
 * unico que importa aqui — nao foi desenhado". Quando o ML cai, quatro das doze
 * telas envelhecem em silencio e o painel continua com cara de saudavel.
 *
 * SO APARECE QUANDO HA O QUE DIZER. Ambar e alerta, nunca decoracao
 * (docs/design-system.md): uma faixa permanente vira paisagem e ninguem le.
 */
import { formatarDuracao } from "@/lib/sla";
import {
  LIMITE_OBSOLESCENCIA_S,
  type EstadoIntegracoes,
} from "@/lib/actions/integracoes";

type Gravidade = "urgente" | "atencao";

interface Alerta {
  gravidade: Gravidade;
  texto: string;
}

/** Traduz o estado em frases acionaveis. Vazio = nada a dizer. */
export function alertasDe({ conexoes, fila, sincronizacoes }: EstadoIntegracoes): Alerta[] {
  const alertas: Alerta[] = [];

  for (const c of conexoes) {
    if (c.estado === "vencido") {
      alertas.push({
        gravidade: "urgente",
        texto: `${rotuloCanal(c.canal)}: o acesso venceu. Nada entra nem sai por este canal ate reconectar.`,
      });
    } else if (c.estado === "vencendo" && c.segundosAteVencer !== null) {
      alertas.push({
        gravidade: "atencao",
        texto: `${rotuloCanal(c.canal)}: o acesso vence em ${formatarDuracao(c.segundosAteVencer)}.`,
      });
    }
  }

  // A mais grave da tela: a pausa que desistiu significa item vendido possivelmente
  // ainda anunciado em outro canal — o dano que a RN-104 existe para impedir.
  if (fila.tarefasEsgotadas > 0) {
    alertas.push({
      gravidade: "urgente",
      texto:
        `${fila.tarefasEsgotadas} acao(oes) de canal desistiram apos varias tentativas. ` +
        "Pode haver item vendido ainda anunciado em outro canal.",
    });
  }

  if (fila.eventosEsgotados > 0) {
    alertas.push({
      gravidade: "urgente",
      texto: `${fila.eventosEsgotados} notificacao(oes) de canal falharam e pararam de ser tentadas.`,
    });
  }

  if (fila.tarefasSemExecutor > 0) {
    alertas.push({
      gravidade: "atencao",
      texto:
        `${fila.tarefasSemExecutor} pausa(s) na OLX aguardando decisao: la "pausar" so existe ` +
        "como apagar o anuncio, e isso precisa ser autorizado.",
    });
  }

  for (const s of sincronizacoes) {
    // Nunca executou NAO e alarme: e falta de agendamento, nao incidente.
    // Tratar os dois igual faria a tela nascer vermelha e virar paisagem.
    if (s.segundosDesdeSucesso === null) continue;
    if (s.segundosDesdeSucesso > LIMITE_OBSOLESCENCIA_S) {
      alertas.push({
        gravidade: "urgente",
        texto:
          `A conferencia de ${s.recurso} nao roda ha ${formatarDuracao(s.segundosDesdeSucesso)}. ` +
          "Venda perdida por notificacao que nao chegou deixa de ser detectada.",
      });
    }
  }

  return alertas;
}

export function rotuloCanal(canal: string): string {
  if (canal === "mercado_livre") return "Mercado Livre";
  if (canal === "olx") return "OLX";
  if (canal === "whatsapp") return "WhatsApp";
  return canal;
}

export function Alertas({ estado }: { estado: EstadoIntegracoes }) {
  const alertas = alertasDe(estado);
  if (alertas.length === 0) return null;

  return (
    <ul aria-label="Alertas das integracoes" className="flex flex-col gap-2">
      {alertas.map((a) => (
        <li
          key={a.texto}
          className={`flex items-start gap-2.5 rounded-card border px-4 py-3 text-[13px] ${
            a.gravidade === "urgente"
              ? "border-danger bg-danger-soft text-danger"
              : "border-warning bg-warning-soft text-warning-note"
          }`}
        >
          <span aria-hidden className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-current" />
          {a.texto}
        </li>
      ))}
    </ul>
  );
}
