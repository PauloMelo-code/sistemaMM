# Autenticacao e Autorizacao

## Estrategia

Usar o server-side nativo do Next.js para autenticacao. Sem JWT exposto no frontend. Sessao gerenciada via cookies HTTP-only.

## Fluxo de Autenticacao

```
1. Usuario acessa /login
2. Envia credenciais via Server Action
3. Server valida credenciais no banco (senha com bcrypt)
4. Cria sessao no banco + cookie HTTP-only
5. Middleware do Next.js verifica cookie em toda requisicao
6. Se valido: permite acesso. Se invalido: redireciona para /login
```

## Implementacao

### Schema de Usuarios e Sessoes

```typescript
// src/lib/db/schema/usuarios.ts
export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  senha_hash: text('senha_hash').notNull(),
  nome: text('nome').notNull(),
  role: text('role').notNull().default('operador'),
  organizacao_id: uuid('organizacao_id')
    .notNull()
    .references(() => organizacoes.id, { onDelete: 'restrict' }),
  ultimo_acesso: timestamp('ultimo_acesso'),
  
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  deleted_at: timestamp('deleted_at'),
  is_deleted: boolean('is_deleted').notNull().default(false),
  modified_by: uuid('modified_by'),
});

export const sessoes = pgTable('sessoes', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'restrict' }),
  token: text('token').notNull().unique(),
  expira_em: timestamp('expira_em').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});
```

### Server Action de Login

```typescript
// src/lib/actions/auth.ts
'use server';

import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { usuarios, sessoes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const senha = formData.get('senha') as string;
  
  const [usuario] = await db.select()
    .from(usuarios)
    .where(and(
      eq(usuarios.email, email),
      eq(usuarios.is_deleted, false),
    ));
  
  if (!usuario) return { erro: 'Credenciais invalidas' };
  
  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaValida) return { erro: 'Credenciais invalidas' };
  
  const token = randomUUID();
  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  
  await db.insert(sessoes).values({
    user_id: usuario.id,
    token,
    expira_em: expiraEm,
  });
  
  await db.update(usuarios)
    .set({ ultimo_acesso: new Date() })
    .where(eq(usuarios.id, usuario.id));
  
  const cookieStore = await cookies();
  cookieStore.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiraEm,
    path: '/',
  });
  
  return { sucesso: true };
}

export async function logout() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  
  if (token) {
    await db.delete(sessoes).where(eq(sessoes.token, token));
    cookieStore.delete('session');
  }
}
```

### Helper de Sessao

```typescript
// src/lib/auth/session.ts
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { sessoes, usuarios } from '@/lib/db/schema';
import { eq, and, gt } from 'drizzle-orm';

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;
  
  const [resultado] = await db.select({
    userId: usuarios.id,
    email: usuarios.email,
    nome: usuarios.nome,
    role: usuarios.role,
    organizacaoId: usuarios.organizacao_id,
  })
    .from(sessoes)
    .innerJoin(usuarios, eq(sessoes.user_id, usuarios.id))
    .where(and(
      eq(sessoes.token, token),
      gt(sessoes.expira_em, new Date()),
      eq(usuarios.is_deleted, false),
    ));
  
  if (!resultado) return null;
  
  return {
    user: {
      id: resultado.userId,
      email: resultado.email,
      nome: resultado.nome,
      role: resultado.role as 'administrador' | 'operador' | 'consultoria',
      organizacao_id: resultado.organizacaoId,
    },
  };
}
```

### Middleware Next.js

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const rotasPublicas = ['/login', '/esqueci-senha'];

export function middleware(request: NextRequest) {
  const session = request.cookies.get('session');
  const ehRotaPublica = rotasPublicas.some(r => 
    request.nextUrl.pathname.startsWith(r)
  );
  
  if (!session && !ehRotaPublica) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  if (session && ehRotaPublica) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

## Seguranca

- Senhas SEMPRE com bcrypt (minimo 12 rounds)
- Cookies HTTP-only, Secure em producao, SameSite=Lax
- Sessoes com expiracao (24h padrao, configuravel)
- NUNCA expor token de sessao no frontend/URL
- Rate limiting em endpoint de login
- Nao revelar se email existe ou nao na mensagem de erro
