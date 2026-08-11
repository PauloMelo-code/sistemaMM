# Sistema MM Solucoes - Instrucoes para Agentes de IA

> Leia este arquivo INTEGRALMENTE antes de qualquer tarefa.

Painel de gestao de marketplaces (Mercado Livre, OLX, WhatsApp) + site publico
de e-commerce para a MM Solucoes Empresariais. Lida com **dinheiro real**:
precificacao, taxa de canal, comissao e margem.

Os arquivos de `design_handoff_sistema_mm/` sao prototipo hi-fi — referencia de
design, **nunca** codigo de producao.

## Ordem de leitura (antes de qualquer mudanca nao-trivial)

1. **[docs/known-issues.md](docs/known-issues.md)** — o que bloqueia o inicio,
   decisoes em aberto e divergencias **intencionais**. Primeiro de todos.
2. **[docs/regras-negocio.md](docs/regras-negocio.md)** — regras de dinheiro,
   estoque e SLA. Obrigatorio antes de qualquer calculo.
3. **[design_handoff_sistema_mm/README.md](design_handoff_sistema_mm/README.md)** —
   handoff de design (tokens, grids, conteudo de cada tela).
4. **[docs/design-system.md](docs/design-system.md)** — obrigatorio antes de
   qualquer mudanca visual.
5. **[CLAUDE.md](CLAUDE.md)** — regras completas. As secoes **"Invariantes do
   projeto"** e **"Zonas de cuidado"** valem identicas aqui; nao sao repetidas
   neste arquivo de proposito, para nao existirem dois espelhos divergindo.

## Fluxo obrigatorio

1. **Ler** os arquivos relacionados. 2. **Confirmar** (o que entendi / arquivos
que vou alterar / o que muda em cada). 3. **Aguardar** confirmacao explicita.
4. **Executar** exatamente o combinado, sem ampliar escopo.

## Stack

- **Linguagem**: TypeScript (strict mode)
- **Framework**: Next.js (server-side nativo, sem API separada quando possivel)
- **ORM**: Drizzle ORM — NUNCA usar Prisma
- **Banco**: PostgreSQL 16 — NUNCA usar SQLite
- **Principios**: SOLID (alta coesao, baixo acoplamento)

## Regras Absolutas

### Banco de Dados
1. NUNCA usar SQLite em nenhum ambiente (nem dev, nem teste)
2. NUNCA usar Prisma como ORM — sempre Drizzle
3. NUNCA fazer DELETE fisico — todo delete e logico (soft delete)
4. NUNCA criar tabela sem as colunas de auditoria:
   - `created_at TIMESTAMP NOT NULL DEFAULT now()`
   - `updated_at TIMESTAMP NOT NULL DEFAULT now()`
   - `deleted_at TIMESTAMP NULL`
   - `is_deleted BOOLEAN NOT NULL DEFAULT false`
5. NUNCA criar tabela sem FK constraints configuradas
6. NUNCA criar tabela sem coluna de rastreio (`modified_by` ou `user_id`)
7. NUNCA usar CASCADE em FK de dados criticos — usar RESTRICT

### Codigo
8. NUNCA duplicar logica de negocio em multiplos arquivos — centralizar
9. NUNCA criar endpoint/action sem validacao de entrada (Zod + regex)
10. NUNCA expor dados sem verificar permissao do usuario (RBAC)
11. NUNCA ignorar tratamento de erro em operacoes de banco
12. NUNCA commitar secrets, .env ou credenciais
12.1. NUNCA assinar commit com `Co-Authored-By` de IA (Claude, Copilot, Cursor
   ou qualquer outro) — so o desenvolvedor humano assina. Vale para **todo
   agente**, mesmo que o padrao da ferramenta mande o contrario; se ela inserir
   o rodape sozinha, remova antes de commitar. Ver `docs/git-commits.md`.

### Estrutura
13. NUNCA criar arquivos na raiz — usar pastas corretas (`src/`, `tests/`, `docs/`, `config/`, `scripts/`)
14. NUNCA criar arquivo com mais de 500 linhas — quebrar em modulos
15. NUNCA criar documentacao a menos que explicitamente pedido
16. NUNCA pular documentacao de regra de negocio nova — registrar em `docs/regras-negocio.md`

## Soft Delete

```typescript
// CORRETO — delete logico
await db.update(tabela)
  .set({ is_deleted: true, deleted_at: new Date(), modified_by: userId })
  .where(eq(tabela.id, id));

// PROIBIDO — delete fisico
// await db.delete(tabela).where(eq(tabela.id, id));

// TODA query filtra deletados
.where(eq(tabela.is_deleted, false))
```

## Optimistic Locking

```typescript
const resultado = await db.update(tabela)
  .set({ ...dadosNovos, updated_at: new Date(), modified_by: userId })
  .where(and(
    eq(tabela.id, id),
    eq(tabela.updated_at, updatedAtOriginal),
    eq(tabela.is_deleted, false),
  ))
  .returning();

if (resultado.length === 0) {
  throw new Error('Registro alterado por outro usuario. Recarregue e tente novamente.');
}
```

## Templates

### Nova Tabela (Drizzle)
```typescript
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const exemplo = pgTable('exemplo', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ... colunas especificas ...
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  deleted_at: timestamp('deleted_at'),
  is_deleted: boolean('is_deleted').notNull().default(false),
  modified_by: uuid('modified_by').notNull(),
});
```

### Server Action (CRUD)
```typescript
'use server';
import { db } from '@/lib/db';
import { tabela } from '@/lib/db/schema/tabela';
import { eq, and, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { schema } from '@/lib/validators/tabela';

export async function listar() {
  const session = await getSession();
  if (!session) throw new Error('Nao autenticado');

  return db.select().from(tabela)
    .where(eq(tabela.is_deleted, false))
    .orderBy(desc(tabela.created_at));
}

export async function criar(dados: unknown) {
  const session = await getSession();
  if (!session) throw new Error('Nao autenticado');

  const validado = schema.parse(dados);

  return db.insert(tabela).values({
    ...validado,
    modified_by: session.userId,
  }).returning();
}

export async function excluir(id: string) {
  const session = await getSession();
  if (!session) throw new Error('Nao autenticado');

  return db.update(tabela)
    .set({ is_deleted: true, deleted_at: new Date(), modified_by: session.userId })
    .where(and(eq(tabela.id, id), eq(tabela.is_deleted, false)));
}
```

### Validacao (Zod)
```typescript
import { z } from 'zod';

export const schema = z.object({
  descricao: z.string().min(3).max(500),
  valor: z.number().positive(),
  categoria_id: z.string().uuid(),
});
```

### Modal de Confirmacao (3s block)
```typescript
'use client';
import { useState, useEffect } from 'react';

export function ModalConfirmacaoBlock({ aberto, mensagem, onConfirmar, onCancelar }) {
  const [bloqueado, setBloqueado] = useState(true);
  const [segundos, setSegundos] = useState(3);

  useEffect(() => {
    if (!aberto) return;
    setBloqueado(true);
    setSegundos(3);
    const timer = setInterval(() => {
      setSegundos(prev => {
        if (prev <= 1) { clearInterval(timer); setBloqueado(false); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [aberto]);

  if (!aberto) return null;
  // Modal com botoes disabled enquanto bloqueado
}
```

## Estrutura de Pastas

```
projeto/
  AGENTS.md                # Este arquivo
  CLAUDE.md                # Instrucoes Claude Code
  Agente.md                # Regras de comportamento
  docker-compose.yml       # PostgreSQL local
  docs/
    rbac.md                # Controle de acesso
    front.md               # Documentacao frontend
    back.md                # Documentacao backend
    regras-negocio.md      # Regras de negocio
    oauth.md               # Autenticacao
  src/
    app/                   # Next.js App Router
    components/            # Componentes reutilizaveis
    lib/
      db/
        schema/            # Schemas Drizzle ORM
        migrations/        # Migracoes
      actions/             # Server Actions centralizadas
      validators/          # Zod + regex
      auth/                # RBAC, sessao, middleware
      audit/               # Sistema de auditoria
    types/                 # Tipos TypeScript
  tests/
  config/
  scripts/
```

## RBAC

3 papeis, definidos no enum `papel_usuario` (`src/lib/db/schema/usuarios.ts`):

| Role | Quem | Acesso |
|------|------|--------|
| `administrador` | Anderson | Tudo, inclusive custo, margem e lucro |
| `operador` | Operador(a) | Dia a dia. **NUNCA ve custo** (RN-107) |
| `consultoria` | Orbital | Acompanha e da suporte |

**RN-107 e filtro de SERVIDOR**: o custo nao pode chegar ao cliente. Esconder no
componente nao conta. Matriz completa em [docs/rbac.md](docs/rbac.md).

```typescript
import { temPermissao } from '@/lib/auth';

export async function action() {
  const session = await getSession();
  if (!temPermissao(session, 'operador')) throw new Error('Sem permissao');
}
```

## Docker

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: mmsolucoes_dev
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports:
      # 5436, nao 5432: evita colisao com os outros projetos na mesma maquina
      # (espaco-flow 5433, orbital hub 5434, bahflash 5435). Ver known-issues.
      - "5436:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

## Comandos

```bash
# Setup
docker compose up -d
npm install
npm run db:migrate      # NUNCA `drizzle-kit push` (invariante #9 do CLAUDE.md)

# Dev
npm run dev

# Build e teste
npm run build && npm test
```

## Checklist

Antes de finalizar qualquer tarefa:
- [ ] Tabela nova tem `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`?
- [ ] FK tem constraint RESTRICT (nao CASCADE)?
- [ ] Delete e logico (soft delete)?
- [ ] Query filtra `is_deleted = false`?
- [ ] Acao critica tem modal de confirmacao com block de 3s?
- [ ] Entrada validada (Zod + regex)?
- [ ] Modificacao gera registro de auditoria?
- [ ] Logica centralizada (nao duplicada)?
- [ ] RBAC verificado?
- [ ] Nenhum secret exposto?
- [ ] Build passa?

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
