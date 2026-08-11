/**
 * TEMPLATE-OURO: Componente de feature (colocation).
 *
 * Padrao de pasta (colocate first, extract later):
 *   src/app/(dashboard)/lancamentos/
 *     page.tsx                 <- server component, busca dados
 *     _components/
 *       lancamentos-lista.tsx  <- ESTE arquivo (client, interativo)
 *       lancamento-form.tsx
 *
 * Regras:
 *   - 1 componente por arquivo, export nomeado, PascalCase.
 *   - Props tipadas com interface explicita (nunca `any`).
 *   - Server Component por padrao; "use client" SO quando precisa de estado/efeito.
 *   - Genericos reutilizaveis vivem em src/components/ui/ (shadcn).
 *   - Acao critica passa por <ModalConfirmacaoBlock> (3s).
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModalConfirmacaoBlock } from "@/components/modal-confirmacao-block";
import { excluir } from "@/lib/actions/lancamentos";
import type { ContratoLancamento } from "@/lib/db/schema/contratos-lancamentos";

interface LancamentosListaProps {
  /** Dados ja carregados pelo server component pai. */
  itens: ContratoLancamento[];
  /** Se o usuario atual pode excluir (RBAC resolvido no servidor). */
  podeExcluir: boolean;
}

export function LancamentosLista({ itens, podeExcluir }: LancamentosListaProps) {
  const [alvo, setAlvo] = useState<ContratoLancamento | null>(null);
  const [processando, setProcessando] = useState(false);

  async function confirmarExclusao() {
    if (!alvo) return;
    setProcessando(true);
    try {
      await excluir(alvo.id);
      setAlvo(null);
      // o pai revalida via revalidatePath na action
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setProcessando(false);
    }
  }

  if (itens.length === 0) {
    return <p className="text-muted-foreground">Nenhum lancamento.</p>;
  }

  return (
    <div className="space-y-3">
      {itens.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle>{item.descricao}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span>R$ {Number(item.valor).toFixed(2)}</span>
            {podeExcluir && (
              <Button variant="destructive" onClick={() => setAlvo(item)}>
                Excluir
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      <ModalConfirmacaoBlock
        aberto={alvo !== null}
        titulo="Excluir lancamento"
        mensagem={`Confirma excluir "${alvo?.descricao}"? Esta acao faz soft delete e fica registrada na auditoria.`}
        onConfirmar={confirmarExclusao}
        onCancelar={() => setAlvo(null)}
        carregando={processando}
      />
    </div>
  );
}
