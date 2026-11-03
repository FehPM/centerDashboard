import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const derived = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// Hash scrypt válido (formato `scrypt$<saltHex>$<hashHex>`) de uma senha
// fixa e nunca usada de verdade. Serve só para pagar o mesmo custo de
// `verifyPassword` quando o email não existe — sem isso, a resposta para
// "usuário inexistente" volta em ~1ms contra ~70ms de "senha errada", um
// oráculo de timing que permite enumerar emails cadastrados pela rede.
export const DUMMY_HASH =
  'scrypt$8ee85cfaeec69f686555b0c1033218be$ce1ec3f525d5eda8728bf862323eef7f8b3cf80edbc5913618e676a78d3398e0b5f82ddc54272fcd7ecfa92261e67912e683ac3ba4365de2367dd047061e3b71';
