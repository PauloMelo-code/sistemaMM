/**
 * Tela Integracoes — portada de `Sistema MM Solucoes.dc.html` (linha 1037).
 *
 * FIDELIDADE: header, grid de 2 colunas, cards com titulo, pill, descricao e
 * lista de capacidades — como o handoff desenhou.
 *
 * DIVERGENCIA DELIBERADA, e e o ponto desta tela: **as pills sao reais** e ha
 * faixa de alerta. No prototipo os cinco cards diziam "Conectado" fixo e nao
 * havia estado de erro nenhum — a auditoria registrou isso como o defeito
 * principal daqui, porque token OAuth expira e, quando o ML cai, quatro das doze
 * telas envelhecem em silencio.
 *
 * Server component: le o estado e nao expoe token nenhum, so "vence em".
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import {
  lerEstadoIntegracoes,
  lerUsuarioML,
  type Conexao,
  type EstadoConexao,
} from "@/lib/actions/integracoes";
import { ReautorizacaoNecessariaError } from "@/lib/integracoes/mercado-livre/token";
import { formatarDuracao } from "@/lib/sla";

import { Alertas } from "./_components/alertas";

/** O estado muda sozinho com o tempo (token vence, fila cresce). Nunca cachear. */
export const dynamic = "force-dynamic";

/**
 * Conteudo fixo de cada card — vem do handoff, nao do banco.
 *
 * Sao capacidades CONTRATADAS, nao estado observado: descrevem o que a conexao
 * faz quando existe. O que muda com a realidade e a pill e a linha de estado.
 */
const CARDS = [
  {
    canal: "mercado_livre" as const,
    titulo: "Mercado Livre · API oficial",
    descricao:
      "Autenticação OAuth na conta da MM Soluções. Sincroniza anúncios, perguntas, pedidos e reputação. Notificações em tempo real por webhook.",
    capacidades: [
      "Publicação e edição de anúncios",
      "Perguntas e respostas",
      "Pedidos e status de envio",
      "Métricas de visitas e reputação",
    ],
  },
  {
    canal: "olx" as const,
    titulo: "OLX · API de importação de anúncios",
    descricao:
      "Integração oficial de anúncios (autoupload): o cadastro feito aqui é publicado e atualizado na OLX automaticamente.",
    capacidades: [
      "Publicação e atualização de anúncios",
      "Remoção de item vendido em outro canal",
    ],
  },
  {
    canal: "whatsapp" as const,
    titulo: "WhatsApp Business",
    descricao:
      "Catálogo, respostas rápidas e registro de venda direta como pedido manual. O nível de integração ainda não foi definido.",
    capacidades: ["Catálogo de produtos", "Registro de venda direta"],
  },
] satisfies Array<{ canal: Conexao["canal"]; titulo: string; descricao: string; capacidades: string[] }>;

/** Cards sem canal no sistema — honestos sobre nao existirem ainda. */
const CARDS_PENDENTES = [
  {
    titulo: "Google · Perfil da Empresa",
    descricao:
      "Endereço, horários e WhatsApp; pedido de avaliação pós-venda e monitoramento de buscas pela marca.",
  },
  {
    titulo: "Emissão de NF-e",
    descricao:
      "Conexão com emissor fiscal e certificado A1. Emissor ainda não escolhido — a etapa NF-e é a primeira do despacho.",
  },
];

const PILL: Record<EstadoConexao, { rotulo: string; classe: string }> = {
  conectado: { rotulo: "Conectado", classe: "bg-success-soft text-success" },
  vencendo: { rotulo: "Vence em breve", classe: "bg-warning-soft text-warning-text" },
  vencido: { rotulo: "Reconectar", classe: "bg-danger text-card font-medium" },
  nao_configurado: { rotulo: "A configurar", classe: "bg-table-head text-ink-2" },
};

export default async function IntegracoesPage() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  // A matriz nega `integracoes` ao operador. Negado EXPLICITO, como em Lotes:
  // redirecionar em silencio pareceria link quebrado.
  if (!temPermissao(sessao.papel, "integracoes", "ler")) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-10">
        <h1 className="font-display text-[18px] font-bold text-navy">Integrações e APIs</h1>
        <p className="max-w-prose text-[13px] text-ink-2">Esta tela não faz parte do seu acesso.</p>
      </div>
    );
  }

  // Decidido no servidor: o botao nem chega ao HTML de quem nao pode. A rota
  // `/iniciar` confere de novo — esconder botao nunca e a protecao.
  const podeConectar = temPermissao(sessao.papel, "integracoes", "atualizar");

  const estado = await lerEstadoIntegracoes();
  const porCanal = new Map(estado.conexoes.map((c) => [c.canal, c]));
  const { fila } = estado;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-display text-[22px] font-bold text-navy">Integrações e APIs</h1>
        <span className="text-[13px] text-ink-2">
          Conexões oficiais com cada canal · sincronização automática
        </span>
      </header>

      <Alertas estado={estado} />

      <div className="grid gap-4 md:grid-cols-2">
        {CARDS.map((card) => {
          const conexao = porCanal.get(card.canal);
          const pill = PILL[conexao?.estado ?? "nao_configurado"];

          return (
            <section
              key={card.titulo}
              className="flex flex-col gap-2.5 rounded-card border border-border bg-card shadow-(--shadow-card) p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[15px] font-bold text-navy">{card.titulo}</h2>
                <span className={`shrink-0 rounded-pill px-2.5 py-[3px] text-[11px] ${pill.classe}`}>
                  {pill.rotulo}
                </span>
              </div>

              <p className="text-[13px] leading-relaxed text-ink-2">{card.descricao}</p>

              {/* A linha que o prototipo nao tinha: o estado observado, nao o
                  prometido. Sem credencial, diz o que falta em vez de calar. */}
              <p className="text-xs text-ink-2">
                {conexao && conexao.estado !== "nao_configurado" ? (
                  <>
                    Conta {conexao.contaExterna ?? "(sem id)"} ·{" "}
                    {conexao.segundosAteVencer !== null && conexao.segundosAteVencer > 0
                      ? `acesso renova em ${formatarDuracao(conexao.segundosAteVencer)}`
                      : "acesso vencido"}
                  </>
                ) : (
                  <>Sem credencial: o aplicativo ainda não foi autorizado nesta conta.</>
                )}
              </p>

              {/* Suspense: com o ML lento, o /users/me leva ate ~45s (3 tentativas
                  de 15s). So esta linha espera, o resto da tela ja aparece. */}
              {card.canal === "mercado_livre" && conexao && conexao.estado !== "nao_configurado" && (
                <Suspense fallback={<p className="text-xs text-ink-2">Consultando a conta no Mercado Livre…</p>}>
                  <UsuarioConectado />
                </Suspense>
              )}

              {/* `<a>` e nao `<Link>`: o Link pre-carrega o destino, e aqui o
                  destino e uma rota que inicia o OAuth e grava cookie. */}
              {card.canal === "mercado_livre" && podeConectar && (
                // Conectado, o botao fica discreto: reconectar troca a conta do
                // painel inteiro, nao e acao para clique por engano.
                <a
                  href="/api/integracoes/oauth/mercado-livre/iniciar"
                  className={`self-start rounded-button px-4 py-2 text-[13px] font-medium foco ${
                    conexao?.estado === "conectado" || conexao?.estado === "vencendo"
                      ? "border border-border text-ink-2"
                      : "bg-navy text-white"
                  }`}
                >
                  {conexao && conexao.estado !== "nao_configurado"
                    ? "Reconectar Mercado Livre"
                    : "Conectar Mercado Livre"}
                </a>
              )}

              <ul className="flex flex-col gap-1 text-xs text-ink">
                {card.capacidades.map((c) => (
                  <li key={c}>✓ {c}</li>
                ))}
              </ul>
            </section>
          );
        })}

        {CARDS_PENDENTES.map((card) => (
          <section
            key={card.titulo}
            className="flex flex-col gap-2.5 rounded-card border border-border bg-card shadow-(--shadow-card) p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[15px] font-bold text-navy">{card.titulo}</h2>
              <span className="shrink-0 rounded-pill bg-table-head px-2.5 py-[3px] text-[11px] text-ink-2">
                A configurar
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">{card.descricao}</p>
          </section>
        ))}
      </div>

      {/* Fila e conferencia: a parte operacional que so passou a existir com a
          integracao. Fica no fim porque e diagnostico, nao o assunto da tela. */}
      <section
        aria-label="Fila e conferência"
        className="flex flex-col gap-3 rounded-card border border-border bg-card shadow-(--shadow-card) p-5"
      >
        <h2 className="font-display text-[15px] font-bold text-navy">Fila e conferência</h2>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] md:grid-cols-4">
          <Numero rotulo="Notificações na fila" valor={fila.eventosPendentes} />
          <Numero rotulo="Notificações falhas" valor={fila.eventosEsgotados} alerta />
          <Numero rotulo="Ações pendentes" valor={fila.tarefasPendentes} />
          <Numero rotulo="Ações que desistiram" valor={fila.tarefasEsgotadas} alerta />
        </dl>

        <ul className="flex flex-col gap-1 border-t border-divider pt-3 text-xs text-ink-2">
          {estado.sincronizacoes.length === 0 ? (
            <li>A conferência contra os canais ainda não rodou nenhuma vez.</li>
          ) : (
            estado.sincronizacoes.map((s) => (
              <li key={s.recurso}>
                {s.recurso}:{" "}
                {s.segundosDesdeSucesso === null
                  ? "nunca concluída"
                  : `última há ${formatarDuracao(s.segundosDesdeSucesso)}`}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

/**
 * Quem o token representa, lido no ML agora (`/users/me`), nao do banco.
 *
 * E a prova de que a conexao funciona: a pill so diz que ha credencial. Falha
 * aqui nao derruba a tela, vira uma linha dizendo o que fazer.
 */
async function UsuarioConectado() {
  // A busca fica no try e o JSX fora: try/catch nao pega erro de render.
  const resultado = await lerUsuarioML().then(
    (usuario) => ({ usuario }),
    (erro: unknown) => {
      console.error("[integracoes] /users/me falhou:", erro);
      return { erro };
    },
  );

  if ("erro" in resultado) {
    return (
      <p className="text-xs text-danger">
        {resultado.erro instanceof ReautorizacaoNecessariaError
          ? "O Mercado Livre recusou a renovação do acesso. É preciso autorizar o aplicativo de novo."
          : "Não foi possível consultar a conta no Mercado Livre agora."}
      </p>
    );
  }

  const { usuario } = resultado;
  return (
    <p className="text-xs text-ink">
      Conectado como <span className="font-medium">{usuario.nickname}</span> · ID {usuario.id} ·{" "}
      {usuario.siteId}
      {usuario.emUserProducts && " · publica no modelo User Products"}
    </p>
  );
}

/** Numero em Archivo (design-system: todo numero que importa). */
function Numero({ rotulo, valor, alerta = false }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[.12em] text-ink-2">{rotulo}</dt>
      <dd
        className={`font-display text-[22px] font-bold tabular-nums ${
          alerta && valor > 0 ? "text-danger" : "text-navy"
        }`}
      >
        {valor}
      </dd>
    </div>
  );
}
