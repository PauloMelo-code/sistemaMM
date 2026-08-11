/**
 * Tela de login.
 *
 * FORA do route group `(painel)`: nao tem sidebar nem shell, e o middleware
 * deixa passar sem sessao — seria circular exigir login para ver o login.
 *
 * O prototipo nao desenhou esta tela (ela nao existe no handoff). O visual
 * segue os tokens do design system: navy, Archivo no titulo, raios da escala.
 */
import type { Metadata } from "next";

import { FormularioLogin } from "./_components/formulario-login";

export const metadata: Metadata = { title: "Entrar · Sistema MM Solucoes" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <LogoMM />
          <p className="text-[13px] text-ink-2">Painel de gestão de marketplaces</p>
        </div>

        <div className="rounded-card border border-border bg-card p-6">
          <FormularioLogin />
        </div>

        <p className="text-center text-xs text-ink-2">
          Acesso restrito. Perdeu a senha? Fale com o administrador — ainda não há
          recuperação automática.
        </p>
      </div>
    </main>
  );
}

/** Mesmo logo da sidebar (handoff): "MM" + as setas laranja. */
function LogoMM() {
  return (
    <svg width="170" height="56" viewBox="0 0 340 110" role="img" aria-label="MM Soluções Empresariais">
      <text x="14" y="62" className="fill-navy font-display" fontWeight="800" fontSize="52" letterSpacing="-2">
        MM
      </text>
      <polygon points="126,18 146,18 166,62 156,62" className="fill-orange" />
      <polygon points="146,18 166,18 186,62 176,62" className="fill-orange" opacity=".55" />
      <text x="14" y="96" className="fill-ink-2 font-body" fontWeight="400" fontSize="15" letterSpacing="4.5">
        SOLUÇÕES EMPRESARIAIS
      </text>
    </svg>
  );
}
