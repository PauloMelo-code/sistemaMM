/**
 * Navegacao de mes.
 *
 * O prototipo cravava "Agosto" no cabecalho, sem seletor — o mesmo defeito que
 * a auditoria apontou em Relatorios ("periodo fixo em ultimos 3 meses, sem
 * seletor"). Aqui o mes vive na URL: link compartilhavel, resiste ao F5, e o
 * fechamento do mes passado continua acessivel depois que o mes vira.
 *
 * Server component: sao tres links, nao ha estado.
 */
import Link from "next/link";

interface FiltroMesProps {
  /** `AAAA-MM` exibido. */
  mes: string;
}

const NOMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `AAAA-MM` deslocado em N meses. `Date` cuida da virada de ano. */
function desloca(mes: string, meses: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + meses, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return `${NOMES[m - 1]} de ${ano}`;
}

export function FiltroMes({ mes }: FiltroMesProps) {
  const anterior = desloca(mes, -1);
  const proximo = desloca(mes, 1);

  return (
    <nav aria-label="Escolher mês" className="flex items-center gap-2">
      <Seta href={`/pedidos?mes=${anterior}`} rotulo={`Mês anterior: ${rotuloDoMes(anterior)}`}>
        ‹
      </Seta>
      <span className="min-w-[9.5rem] text-center text-[13px] font-medium capitalize text-ink">
        {rotuloDoMes(mes)}
      </span>
      {/* O proximo mes existe mesmo no futuro: e assim que se confere se algo
          caiu no mes errado — que e justamente o bug que a RN-114 evita. */}
      <Seta href={`/pedidos?mes=${proximo}`} rotulo={`Mês seguinte: ${rotuloDoMes(proximo)}`}>
        ›
      </Seta>
    </nav>
  );
}

function Seta({
  href,
  rotulo,
  children,
}: {
  href: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={rotulo}
      title={rotulo}
      className="rounded-button border border-border-input px-2.5 py-1 text-[15px] leading-none text-ink hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      {children}
    </Link>
  );
}
