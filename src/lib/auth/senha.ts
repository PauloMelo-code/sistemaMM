/**
 * Hash de senha com `scrypt` da stdlib do Node.
 *
 * ⚠️ DIVERGE de `docs/oauth.md`, que prescreve bcrypt. Motivo: bcrypt e
 * dependencia nova (e o CLAUDE.md proibe instalar sem autorizacao), enquanto
 * `scrypt` ja vem no Node — e e KDF de senha adequado, memory-hard por desenho,
 * o que encarece ataque com GPU mais do que bcrypt. Decidido com o Paulo em
 * 2026-08-11 e registrado em docs/known-issues.md.
 *
 * Modulo PURO: nao importa banco, nao le cookie. So texto entra e texto sai —
 * por isso da para testar sem Postgres no ar.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify` escolhe a sobrecarga SEM opcoes do `scrypt`, entao o tipo precisa
 * ser declarado a mao — sem isso os parametros de custo abaixo seriam ignorados
 * pelo TypeScript e silenciosamente descartados.
 */
const scryptAsync = promisify(scrypt) as (
  senha: string,
  salt: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
) => Promise<Buffer>;

/**
 * Custo do KDF. `N` e o fator que domina tempo e memoria.
 *
 * 2^15 (32768) com r=8 leva dezenas de milissegundos — aceitavel num login
 * manual de duas pessoas, e caro o suficiente para forca bruta. Nao baixe
 * "porque o teste esta lento": o custo E a protecao.
 */
const N = 32768;
const r = 8;
const p = 1;
const TAMANHO_CHAVE = 64;
const TAMANHO_SALT = 16;

/**
 * ⚠️ `maxmem` PRECISA ser declarado. O scrypt usa ~`128 * N * r` bytes, que
 * aqui da ~33,5 MB — acima do teto padrao do Node, de 32 MB. Sem esta linha o
 * `scrypt` LANCA em toda chamada, e como `conferirSenha` engole excecao para
 * nao vazar informacao, **todo login falharia dizendo apenas "credenciais
 * invalidas"** — o pior tipo de bug: parece regra de negocio funcionando.
 * 64 MB da folga sem exagero.
 */
const OPCOES: ScryptOptions = { N, r, p, maxmem: 64 * 1024 * 1024 };

/** Prefixo de versao: permite trocar parametros depois sem quebrar o que existe. */
const VERSAO = "scrypt-n15";

/**
 * Devolve `scrypt-n15.<salt>.<hash>`, em base64url.
 *
 * Salt NOVO a cada senha: sem ele, duas pessoas com a mesma senha teriam o
 * mesmo hash, e uma tabela pre-calculada quebraria as duas de uma vez.
 */
export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(TAMANHO_SALT);
  const chave = await scryptAsync(senha, salt, TAMANHO_CHAVE, OPCOES);
  return [VERSAO, salt.toString("base64url"), chave.toString("base64url")].join(".");
}

/**
 * Confere a senha contra o hash guardado.
 *
 * Comparacao em TEMPO CONSTANTE: `===` vaza, pelo tempo de resposta, quantos
 * bytes iniciais bateram — e com isso da para descobrir o hash byte a byte.
 *
 * Nunca lanca: hash corrompido, formato desconhecido ou versao futura viram
 * `false`. Login que explode por dado estranho no banco entrega ao atacante a
 * informacao de que aquele usuario existe.
 */
export async function conferirSenha(senha: string, hashGuardado: string): Promise<boolean> {
  try {
    const partes = hashGuardado.split(".");
    if (partes.length !== 3 || partes[0] !== VERSAO) return false;

    const salt = Buffer.from(partes[1], "base64url");
    const esperado = Buffer.from(partes[2], "base64url");
    if (salt.length !== TAMANHO_SALT || esperado.length !== TAMANHO_CHAVE) return false;

    const calculado = await scryptAsync(senha, salt, TAMANHO_CHAVE, OPCOES);
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

/** Tamanho minimo aceito. Curto demais nao e KDF que resolve. */
export const TAMANHO_MINIMO_SENHA = 12;

/**
 * Valida a senha ANTES de virar hash. Devolve o motivo, ou `null` se serve.
 *
 * Deliberadamente simples: comprimento minimo, e so. Regra de "um numero, uma
 * maiuscula e um simbolo" empurra as pessoas para `Senha@123` — previsivel — e
 * para o post-it no monitor. Comprimento e o que realmente pesa.
 */
export function validarSenha(senha: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    return `A senha precisa de pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  return null;
}
