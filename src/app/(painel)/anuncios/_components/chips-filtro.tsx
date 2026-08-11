/**
 * Chips de filtro — do handoff: Todos · Mercado Livre · OLX · No ar ·
 * Negociando · Pausados.
 *
 * SERVER COMPONENT, e os chips sao LINKS. O prototipo sugeria estado de tela,
 * mas filtro na URL sai de graca melhor: vira link compartilhavel ("me manda os
 * pausados"), sobrevive ao F5 e ao botao voltar, e nao precisa de JavaScript
 * nenhum no cliente. Estado de cliente aqui so acrescentaria hidratacao.
 */
import Link from "next/link";

import type { StatusAnuncio } from "@/lib/actions/anuncios";
import type { Canal } from "@/lib/pricing";

interface ChipsFiltroProps {
  canal?: Canal;
  status?: StatusAnuncio;
}

const CHIPS: Array<{ rotulo: string; canal?: Canal; status?: StatusAnuncio }> = [
  { rotulo: "Todos" },
  { rotulo: "Mercado Livre", canal: "mercado_livre" },
  { rotulo: "OLX", canal: "olx" },
  { rotulo: "No ar", status: "no_ar" },
  { rotulo: "Negociando", status: "negociando" },
  { rotulo: "Pausados", status: "pausado" },
];

export function ChipsFiltro({ canal, status }: ChipsFiltroProps) {
  return (
    <nav aria-label="Filtrar anúncios" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        // Canal e status sao filtros INDEPENDENTES: clicar em "Pausados" mantem
        // o canal escolhido. Um so conjunto de chips manipulando dois eixos
        // exige isso, senao clicar num zera o outro sem avisar.
        const destino = new URLSearchParams();
        const canalDestino = chip.canal ?? (chip.status ? canal : undefined);
        const statusDestino = chip.status ?? (chip.canal ? status : undefined);
        if (canalDestino) destino.set("canal", canalDestino);
        if (statusDestino) destino.set("status", statusDestino);

        const ativo = chip.canal
          ? canal === chip.canal
          : chip.status
            ? status === chip.status
            : !canal && !status;

        const query = destino.toString();

        return (
          <Link
            key={chip.rotulo}
            href={query ? `/anuncios?${query}` : "/anuncios"}
            aria-current={ativo ? "true" : undefined}
            className={`rounded-button px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
              ativo
                ? "bg-navy text-white"
                : "border border-border-input text-ink hover:bg-table-head"
            }`}
          >
            {chip.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
