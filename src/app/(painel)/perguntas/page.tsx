/**
 * Tela Perguntas — caixa unificada ML / OLX / WhatsApp.
 * Portada de `Sistema MM Solucoes.dc.html` (bloco `isPerguntas`, linhas 246-322)
 * com uma divergencia deliberada do prototipo: a escala de cor do SLA, que la
 * saia invertida. A regra corrigida e a RN-105.1.
 *
 * Server component: busca a fila e resolve a ordem. Nao ha custo nesta tela,
 * entao a RN-107 nao filtra nada aqui.
 */
import { listarPerguntas } from "@/lib/actions/perguntas";
import { META_SLA_HORAS } from "@/lib/sla";

import { ListaPerguntas } from "./_components/lista-perguntas";

/**
 * O prazo muda a cada segundo — servir HTML de cache seria servir cor errada.
 * `force-dynamic` garante que cada visita recalcule `prazo_sla - now()`.
 */
export const dynamic = "force-dynamic";

/**
 * Modelos de resposta do handoff.
 *
 * CONSTANTE, nao tabela: o prototipo nao desenhou nenhuma tela de edicao, e
 * criar entidade sem CRUD seria inventar escopo. Quando o Anderson quiser
 * editar os proprios modelos, isto vira `perguntas_modelos` via `/criar-tabela`
 * (registrado em docs/known-issues.md).
 */
const MODELOS = [
  {
    titulo: "NF + prazo de envio",
    texto: "“Sim, emitimos NF-e. O envio sai de Maringá/PR em até 2 dias úteis…”",
  },
  {
    titulo: "Garantia e revisão",
    texto:
      "“O equipamento passa por checagem de funcionamento antes do envio, com 90 dias de garantia…”",
  },
  {
    titulo: "Retirada em mãos",
    texto:
      "“Retirada em Maringá/PR com agendamento. Aceitamos PIX na entrega…”",
  },
  {
    titulo: "Negociação de preço",
    texto:
      "“Conseguimos condição especial à vista. Me confirma a forma de pagamento…”",
  },
];

export default async function PerguntasPage() {
  const { perguntas, truncada } = await listarPerguntas();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-display text-[22px] font-bold text-navy">Perguntas</h1>
        <span className="text-[13px] text-ink-2">
          Caixa unificada · Mercado Livre, OLX e WhatsApp · meta de resposta: {META_SLA_HORAS}h
        </span>
      </header>

      {/* Grid 1.4fr 1fr do handoff (design-system.md > grids.perguntas) a partir
          de `lg`. Abaixo disso as duas colunas empilham.

          O ponto de corte nao e gosto: a coluna de modelos precisa de ~260px
          para o texto do modelo ficar legivel, e ela recebe 1/2.4 do espaco
          util. Descontando sidebar (236px) e padding do main (64px), 260px so
          sobram a partir de ~924px de janela — `lg` (1024px) e o degrau padrao
          logo acima disso.

          A fila vem primeiro no DOM, entao empilhada ela fica em cima: e a
          tarefa da tela; modelo de resposta e apoio. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section
          aria-label="Fila de perguntas"
          className="overflow-hidden rounded-card border border-border bg-card"
        >
          <ListaPerguntas perguntas={perguntas} truncada={truncada} />
        </section>

        <section
          aria-label="Modelos de resposta"
          className="overflow-hidden rounded-card border border-border bg-card"
        >
          <h2 className="border-b border-border px-5 py-4 font-display text-[15px] font-bold text-navy">
            Modelos de resposta
          </h2>
          <ul className="flex flex-col text-[13px]">
            {MODELOS.map((modelo) => (
              <li
                key={modelo.titulo}
                className="flex flex-col gap-0.5 border-b border-divider px-5 py-[13px] last:border-b-0"
              >
                <span className="font-medium">{modelo.titulo}</span>
                <span className="text-xs text-ink-2">{modelo.texto}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
