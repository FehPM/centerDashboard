import type { AppConfig } from '../../config.js';

export const testConfig = {
  port: 0, databaseUrl: 'postgresql://x', redisUrl: 'redis://x',
  jwtSecret: 'x'.repeat(32), piiPepper: 'y'.repeat(32),
  credentialsEncryptionKey: 'a'.repeat(64),
  anthropicApiKey: 'sk-ant-test',
  uappiBaseUrl: 'https://api.uappi.com.br', ga4CredentialsJson: '', ga4AppCredentialsJson: '',
  syncIntervalMinutes: 30, syncBackfillDays: 90, mockExternalApis: false,
  operatorJwtSecret: 'z'.repeat(32),
  panelOrigin: 'http://localhost:5173', backofficeOrigin: 'http://localhost:5174',
  mondayApiToken: '',
  whatsapp: { appSecret: 's', verifyToken: 'v', accessToken: 'a', phoneNumberId: '1' },
} satisfies AppConfig;
