# Workflow — corrigir bug no MM Soluções

## 1. Ler antes de tocar

- `docs/known-issues.md` — **primeiro de todos**: o que bloqueia, o que não foi decidido e o que é divergência intencional
- `docs/regras-negocio.md` — regras de dinheiro, estoque e SLA. **Obrigatório antes de qualquer cálculo**
- `docs/architecture.md` e `docs/design-system.md`
- O arquivo real que você vai alterar

## 2. Localizar a camada

| Sintoma | Comece por |
| :--- | :--- |
| Preço, margem ou lucro errado | `src/lib/pricing.ts` — e confira se alguém recalculou por fora |
| Item vendido duas vezes / anúncio não pausou | idempotência do webhook de venda do ML (RN-104) |
| Operador viu o custo | o filtro é no **servidor** — se o campo chegou ao cliente, é violação (RN-107) |
| Valor com centavo errado / arredondamento | `numeric`, não `float` |
| Perguntas estourando SLA de 4h | o alerta é parte do valor contratado — não é enfeite |
| Cor errada | token; âmbar é alerta, verde #1FA855 é só WhatsApp |
| Confusão entre Estoque e Lotes | no protótipo o state `itens` é a tela **Estoque** e `estoque` é a tela **Lotes** (known-issues 🟢) |
| Expedição travada no primeiro passo | o stepper começa em NF-e — integração que **ainda não existe** |

## 3. Diagnosticar sem escrever

Reproduza e leia o estado antes de editar. Confira a trilha de auditoria: quem fez, o quê, quando.
Se for escrever script de diagnóstico, ele tem que percorrer **o mesmo caminho do código de
produção** — script que testa por fora mente.

## 4. Corrigir a causa, não o sintoma

Antes de editar, `grep` por **todos os chamadores** da função que você vai tocar. A guarda certa
fica na função compartilhada, não em cada chamador — senão o bug continua vivo nos irmãos.

## 5. Provar

```bash
npm run typecheck
npm test
npm run lint
```

## 6. Reportar

Sintoma × causa raiz · arquivos lidos e alterados · invariantes tocados · saída dos comandos acima ·
risco residual.
