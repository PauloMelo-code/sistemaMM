# Frontend - Documentacao

## Stack

- **Framework**: Next.js 16 (App Router)
- **Linguagem**: TypeScript strict
- **Estilizacao**: Tailwind v4 **CSS-first** — tokens no `@theme` de
  `src/app/globals.css`, NAO existe `tailwind.config.js`
- **Componentes**: Reutilizaveis em `src/components/`
- **Validacao**: Zod (instalado). Biblioteca de **formulario** ainda nao
  escolhida — React Hook Form **nao** esta no projeto, nao importe
- **Estado**: Server Components por padrao, Client Components apenas quando necessario

## Estrutura de Pastas

```
src/
  app/
    (auth)/                  # Grupo de rotas autenticadas
      layout.tsx             # Layout com sidebar/header
      dashboard/
        page.tsx             # Dashboard principal
      lancamentos/
        page.tsx             # Listagem
        [id]/
          page.tsx           # Detalhe/edicao
        novo/
          page.tsx           # Criacao
    (public)/                # Rotas publicas
      login/
        page.tsx
    api/                     # API routes (usar apenas quando necessario)
    layout.tsx               # Root layout
    
  components/
    ui/                      # Componentes base (botao, input, modal)
      modal-confirmacao-block.tsx  # Modal com block de 3 segundos
    forms/                   # Componentes de formulario
    tables/                  # Componentes de tabela/listagem
    layout/                  # Header, sidebar, footer
```

## Padroes Obrigatorios

### 1. Server Components por Padrao
Usar `'use client'` APENAS quando o componente precisa de:
- useState, useEffect, useRef
- Event handlers (onClick, onChange)
- Browser APIs

### 2. Server Actions para Mutacoes
NAO criar API routes para CRUD. Usar Server Actions:
```typescript
// src/lib/actions/lancamentos.ts
'use server';

export async function criarLancamento(formData: FormData) {
  // validacao, RBAC, logica, auditoria
}
```

### 3. Modal de Confirmacao com Block
Toda acao destrutiva ou critica deve usar o `ModalConfirmacaoBlock`:
- Excluir registros
- Salvar lancamentos financeiros
- Alterar contratos
- Qualquer acao que impacte calculos

### 4. Feedback Visual
- Loading states em todas as acoes assincronas
- Mensagens de erro claras e em portugues
- Toast/notificacao apos sucesso ou erro
- Desabilitar botao de submit durante processamento

### 5. Responsividade
- Mobile-first
- Tabelas com scroll horizontal em mobile
- Menu colapsavel em telas menores

## Regras de Componentes

- Componentes reutilizaveis ficam em `src/components/`
- Componentes especificos de uma pagina ficam junto da pagina
- Nao duplicar componentes — reusar e parametrizar
- Props tipadas com TypeScript (nunca `any`)
- Nomes de componentes em PascalCase
- Nomes de arquivos em kebab-case

## Next.js Server-Side

Aproveitar o server-side nativo do Next.js:
- Autenticacao via middleware + cookies (sem JWT exposto no front)
- Data fetching direto no Server Component (sem useEffect + fetch)
- Server Actions para mutacoes (sem API routes separadas)
- Middleware para protecao de rotas

```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  const session = request.cookies.get('session');
  if (!session && request.nextUrl.pathname.startsWith('/(auth)')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
```
