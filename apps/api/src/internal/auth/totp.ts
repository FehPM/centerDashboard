import { authenticator } from 'otplib';

// Janela de 1 passo (30 s) para cada lado, tolerando pequeno desvio de relógio.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'Center Back-office', secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}
