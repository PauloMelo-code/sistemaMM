# RBAC - Controle de Acesso Baseado em Roles

## Roles do Sistema

Os papeis reais sao **tres**, definidos no enum `papel_usuario`
(`src/lib/db/schema/usuarios.ts`) e vindos da tela Equipe do handoff:

| Role | Quem | Descricao |
|------|------|-----------|
| `administrador` | Anderson | Dono da operacao. Ve tudo, inclusive custo, margem e lucro |
| `operador` | Operador(a) em treinamento | Opera o dia a dia. **NUNCA ve custo** (RN-107) |
| `consultoria` | Orbital | Acompanha e da suporte |

> Nao existe `super_admin` nem `visualizador` neste sistema. Papel novo entra no
> enum **e** numa migracao — nao invente em codigo.

## A regra que manda: RN-107

**Operador nao ve custo.** Vale para custo de arremate (`itens.custo`), custo do
lote (`lotes.custo_total`), preco alvo, margem e lucro (`pricing.ts`).
O filtro e **no servidor**: o campo nao pode chegar ao cliente. Esconder por CSS
ou por `hidden` no componente nao conta — o dado ja vazou no payload.

## Matriz de Permissoes

> ⚠️ **Rascunho a validar com o Anderson.** So a linha do operador em relacao a
> custo esta cravada (RN-107); o resto e proposta. Ver `docs/known-issues.md`.

```
C = Criar | R = Ler | U = Atualizar | D = Deletar (logico)
```

| Recurso | administrador | operador | consultoria |
|---------|---------------|----------|-------------|
| Lotes (com custo) | CRUD | **—** | R |
| Itens — dados operacionais | CRUD | CRU | R |
| Itens — custo / preco alvo | CRUD | **—** | R |
| Anuncios | CRUD | CRU | R |
| Perguntas | CRUD | CRU | R |
| Pedidos — dados operacionais | CRUD | CRU | R |
| Pedidos — valor / taxa / comissao | CRUD | **—** | R |
| Calculadora de preco | CRUD | **—** | R |
| Relatorios com margem | R | **—** | R |
| Equipe / comissoes | CRUD | — | R |
| Configuracoes | CRUD | — | — |
| Auditoria | R | — | R |
| Site / CMS | CRUD | CRU | R |

## Implementacao

### Middleware de Verificacao
Toda rota/action deve verificar permissao antes de executar:

```typescript
// src/lib/auth/rbac.ts
type Role = 'administrador' | 'operador' | 'consultoria';
type Acao = 'criar' | 'ler' | 'atualizar' | 'deletar';

const permissoes: Record<string, Role[]> = {
  'itens:criar': ['administrador', 'operador'],
  'itens:ler': ['administrador', 'operador', 'consultoria'],
  'itens:atualizar': ['administrador', 'operador'],
  'itens:deletar': ['administrador'],
  // RN-107 — custo, margem e lucro NUNCA para o operador
  'itens.custo:ler': ['administrador', 'consultoria'],
  'lotes.custo:ler': ['administrador', 'consultoria'],
  'calculadora:ler': ['administrador', 'consultoria'],
  'auditoria:ler': ['administrador', 'consultoria'],
  // ... adicionar todas as permissoes
};

export function temPermissao(role: Role, recurso: string, acao: Acao): boolean {
  const chave = `${recurso}:${acao}`;
  return permissoes[chave]?.includes(role) ?? false;
}
```

### Uso em Server Actions
```typescript
// Toda action deve comecar com verificacao
export async function criarLancamento(dados: FormData) {
  const session = await getSession();
  if (!session) throw new Error('Nao autenticado');
  
  if (!temPermissao(session.user.role, 'lancamentos', 'criar')) {
    throw new Error('Sem permissao para criar lancamentos');
  }
  
  // ... logica da action
}
```

## Dashboard do Owner

Visivel apenas para `administrador`. Mostra:

1. **Alertas de Erro**: lancamentos com categoria incorreta, dados inconsistentes
2. **Erros por Usuario**: volume de erros agrupado por usuario
3. **Detalhes do Erro**: ao clicar, mostra o que foi lancado vs o que deveria ser
4. **Registros Deletados**: quem deletou, quando, qual registro
5. **Historico de Alteracoes**: timeline de todas as modificacoes no sistema

## Regras

- Nenhum usuario pode acessar dados de outro tenant/organizacao
- Super admin ve TODOS os tenants
- Toda tentativa de acesso negado deve ser logada na auditoria
- Sessoes expiram apos periodo de inatividade configuravel
