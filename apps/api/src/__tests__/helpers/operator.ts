import { createHmac } from 'node:crypto';
import { testConfig } from './config.js';

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Token de sessão do operador assinado à mão (HS256, aud = operator), sem passar por login e TOTP. */
export function operatorToken(operatorId = 'op_1'): string {
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    operatorId, stage: 'session', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600,
  })}`;
  const sig = createHmac('sha256', testConfig.operatorJwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
