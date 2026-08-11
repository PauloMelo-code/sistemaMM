# Agente.md - Regras de Comportamento dos Agentes IA

## Objetivo
Este arquivo define como os agentes IA devem se comportar ao criar, modificar ou revisar codigo neste projeto. Todo agente DEVE ler este arquivo antes de executar qualquer tarefa.

## Regras que o Agente NUNCA Deve Quebrar

### Banco de Dados
1. **NUNCA** gerar codigo com SQLite — sempre PostgreSQL
2. **NUNCA** gerar codigo com Prisma — sempre Drizzle ORM
3. **NUNCA** gerar DELETE fisico — sempre soft delete com `is_deleted = true`
4. **NUNCA** criar tabela sem: `created_at`, `updated_at`, `deleted_at`, `is_deleted`
5. **NUNCA** criar tabela sem FK constraints configuradas
6. **NUNCA** criar tabela sem coluna de rastreio de usuario (`modified_by` ou `user_id`)
7. **NUNCA** usar CASCADE em FK de dados criticos — usar RESTRICT

### Codigo
8. **NUNCA** duplicar logica de negocio em multiplos arquivos — centralizar
9. **NUNCA** criar endpoint/action sem validacao de entrada
10. **NUNCA** expor dados sem verificar permissao do usuario (RBAC)
11. **NUNCA** ignorar tratamento de erro em operacoes de banco
12. **NUNCA** commitar secrets, .env ou credenciais

### Estrutura
13. **NUNCA** criar arquivos na raiz — usar pastas corretas (`src/`, `tests/`, `docs/`, `config/`, `scripts/`)
14. **NUNCA** criar arquivo com mais de 500 linhas — quebrar em modulos
15. **NUNCA** pular documentacao de regra de negocio nova — registrar em `docs/regras-negocio.md`

## Como o Agente Deve Criar Tabelas

Template obrigatorio para toda nova tabela:

```typescript
// src/lib/db/schema/exemplo.ts
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const exemplo = pgTable('exemplo', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // ... colunas especificas da tabela ...
  
  // COLUNAS OBRIGATORIAS - nunca omitir
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  deleted_at: timestamp('deleted_at'),
  is_deleted: boolean('is_deleted').notNull().default(false),
  modified_by: uuid('modified_by').notNull(),
});
```

## Como o Agente Deve Implementar Exclusao

```typescript
// CORRETO - Soft Delete
export async function excluirRegistro(id: string, userId: string) {
  return db.update(tabela)
    .set({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date(),
      modified_by: userId,
    })
    .where(and(
      eq(tabela.id, id),
      eq(tabela.is_deleted, false),
    ));
}

// TODA query deve filtrar deletados
export async function listarRegistros() {
  return db.select()
    .from(tabela)
    .where(eq(tabela.is_deleted, false))
    .orderBy(desc(tabela.created_at));
}
```

## Como o Agente Deve Implementar Auditoria

Toda acao que modifica dados deve gerar registro de auditoria:

```typescript
// src/lib/audit/logger.ts
export async function registrarAuditoria(params: {
  userId: string;
  acao: 'criar' | 'atualizar' | 'excluir';
  tabela: string;
  registroId: string;
  detalhes: string;
  dadosAnteriores?: Record<string, unknown>;
  dadosNovos?: Record<string, unknown>;
}) {
  await db.insert(auditoria).values({
    user_id: params.userId,
    acao: params.acao,
    tabela: params.tabela,
    registro_id: params.registroId,
    detalhes: params.detalhes,
    dados_anteriores: params.dadosAnteriores ? JSON.stringify(params.dadosAnteriores) : null,
    dados_novos: params.dadosNovos ? JSON.stringify(params.dadosNovos) : null,
    created_at: new Date(),
  });
}
```

## Como o Agente Deve Implementar Validacao

### Validacao com Regex
Antes de salvar, validar se os dados fazem sentido:

```typescript
// src/lib/validators/lancamento.ts
import { z } from 'zod';

export const lancamentoSchema = z.object({
  descricao: z.string().min(3).max(500),
  valor: z.number().positive(),
  categoria_id: z.string().uuid(),
  // Regex para validar formatos especificos
  codigo_referencia: z.string().regex(/^[A-Z]{2,4}-\d{4,8}$/, 
    'Formato invalido. Use: XX-0000'),
});

// Validar ANTES de qualquer operacao de banco
export function validarLancamento(dados: unknown) {
  return lancamentoSchema.safeParse(dados);
}
```

### Modal de Confirmacao com Block (3 segundos)
Para acoes criticas, o agente deve gerar componente de modal bloqueante:

```typescript
// src/components/modal-confirmacao-block.tsx
'use client';
import { useState, useEffect } from 'react';

interface Props {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ModalConfirmacaoBlock({ aberto, titulo, mensagem, onConfirmar, onCancelar }: Props) {
  const [bloqueado, setBloqueado] = useState(true);
  const [segundos, setSegundos] = useState(3);

  useEffect(() => {
    if (!aberto) return;
    setBloqueado(true);
    setSegundos(3);
    
    const intervalo = setInterval(() => {
      setSegundos(prev => {
        if (prev <= 1) {
          clearInterval(intervalo);
          setBloqueado(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(intervalo);
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-lg font-bold mb-2">{titulo}</h2>
        <p className="text-gray-700 mb-4">{mensagem}</p>
        
        {bloqueado && (
          <p className="text-sm text-orange-600 mb-4">
            Leia a mensagem acima. Botoes liberados em {segundos}s...
          </p>
        )}
        
        <div className="flex gap-3 justify-end">
          <button
            disabled={bloqueado}
            onClick={onCancelar}
            className="px-4 py-2 border rounded disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            disabled={bloqueado}
            onClick={onConfirmar}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Checklist do Agente Antes de Finalizar Qualquer Tarefa

- [ ] Toda tabela nova tem `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`?
- [ ] Toda FK tem constraint RESTRICT (nao CASCADE)?
- [ ] Todo delete e logico (soft delete)?
- [ ] Toda query filtra `is_deleted = false`?
- [ ] Toda acao critica tem modal de confirmacao com block de 3s?
- [ ] Toda entrada do usuario e validada (regex/zod)?
- [ ] Toda modificacao gera registro de auditoria?
- [ ] Logica de negocio esta centralizada (nao duplicada)?
- [ ] Regra de negocio nova foi documentada em `docs/regras-negocio.md`?
- [ ] Nenhum secret/env foi exposto?
- [ ] RBAC verificado — usuario tem permissao para esta acao?

## Roteamento de Agentes por Tipo de Tarefa

| Tarefa | Agente | O que Faz |
|--------|--------|-----------|
| Criar tabela/schema | `coder` | Gera schema Drizzle com todas colunas obrigatorias |
| CRUD de entidade | `coder` | Implementa create/read/update/soft-delete com auditoria |
| Regra de negocio | `system-architect` + `coder` | Arquiteta a regra centralizada, coder implementa |
| Validacao de dados | `coder` | Cria schemas zod + regex no validators/ |
| Tela/componente | `coder` | Implementa com modal block quando necessario |
| Revisar codigo | `reviewer` | Verifica se todas as regras deste arquivo foram seguidas |
| Testar | `tester` | Cria testes verificando soft delete, auditoria, validacao |
| Seguranca | `security-auditor` | Verifica RBAC, exposicao de dados, injection |
| Documentar regra | `coder` | Atualiza docs/regras-negocio.md |
| Sincronizar docs | `coder` (skill `/repo-docs-sync`) | Audita drift codigo<->docs e atualiza CLAUDE.md/AGENTS.md/docs |
