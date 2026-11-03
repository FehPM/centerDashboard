import { loadConfig } from '../config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://center:center@localhost:5432/center',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  PII_PEPPER: 'y'.repeat(32),
  CREDENTIALS_ENCRYPTION_KEY: 'a'.repeat(64),
  ANTHROPIC_API_KEY: 'sk-ant-test',
  UAPPI_BASE_URL: 'https://api.uappi.com.br',
  OPERATOR_JWT_SECRET: 'o'.repeat(32),
  WHATSAPP_APP_SECRET: 'secret',
  WHATSAPP_VERIFY_TOKEN: 'verify',
  WHATSAPP_ACCESS_TOKEN: 'access',
  WHATSAPP_PHONE_NUMBER_ID: '123',
};

describe('loadConfig', () => {
  it('parses a complete environment', () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3333);
    expect(config.uappiBaseUrl).toBe('https://api.uappi.com.br');
  });

  it('honours an explicit PORT', () => {
    expect(loadConfig({ ...validEnv, PORT: '8080' }).port).toBe(8080);
  });

  it('throws naming the missing variable', () => {
    const { JWT_SECRET: _omitted, ...incomplete } = validEnv;
    expect(() => loadConfig(incomplete)).toThrow(/JWT_SECRET/);
  });

  it('rejects a PII pepper shorter than 32 characters', () => {
    expect(() => loadConfig({ ...validEnv, PII_PEPPER: 'curto' })).toThrow(/PII_PEPPER/);
  });

  it('rejects a credentials encryption key that is not 64 hex characters', () => {
    expect(() => loadConfig({ ...validEnv, CREDENTIALS_ENCRYPTION_KEY: 'curto' }))
      .toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...validEnv, CREDENTIALS_ENCRYPTION_KEY: 'z'.repeat(64) }))
      .toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('defaults the sync interval to 30 minutes', () => {
    expect(loadConfig(validEnv).syncIntervalMinutes).toBe(30);
  });

  it('refuses a sync interval below 10 minutes', () => {
    expect(() => loadConfig({ ...validEnv, SYNC_INTERVAL_MINUTES: '2' }))
      .toThrow(/SYNC_INTERVAL_MINUTES/);
  });

  it('defaults mockExternalApis to false', () => {
    expect(loadConfig(validEnv).mockExternalApis).toBe(false);
  });

  it('parses the literal string "true" as true, and everything else as false', () => {
    expect(loadConfig({ ...validEnv, MOCK_EXTERNAL_APIS: 'true' }).mockExternalApis).toBe(true);
    expect(loadConfig({ ...validEnv, MOCK_EXTERNAL_APIS: 'false' }).mockExternalApis).toBe(false);
    expect(loadConfig({ ...validEnv, MOCK_EXTERNAL_APIS: 'yes' }).mockExternalApis).toBe(false);
  });

  it('loads without WHATSAPP_* and sets whatsapp to null', () => {
    const { WHATSAPP_APP_SECRET: _a, WHATSAPP_VERIFY_TOKEN: _b, WHATSAPP_ACCESS_TOKEN: _c,
      WHATSAPP_PHONE_NUMBER_ID: _d, ...withoutWhatsapp } = validEnv;
    expect(loadConfig(withoutWhatsapp).whatsapp).toBeNull();
    expect(loadConfig({ ...validEnv, WHATSAPP_ACCESS_TOKEN: '' }).whatsapp).toBeNull();
    expect(loadConfig(validEnv).whatsapp).not.toBeNull();
  });

  it('rejects OPERATOR_JWT_SECRET equal to JWT_SECRET', () => {
    expect(() => loadConfig({ ...validEnv, OPERATOR_JWT_SECRET: validEnv.JWT_SECRET }))
      .toThrow(/OPERATOR_JWT_SECRET/);
  });

  it('rejects a short or missing OPERATOR_JWT_SECRET', () => {
    expect(() => loadConfig({ ...validEnv, OPERATOR_JWT_SECRET: 'curto' })).toThrow(/OPERATOR_JWT_SECRET/);
    const { OPERATOR_JWT_SECRET: _omitted, ...incomplete } = validEnv;
    expect(() => loadConfig(incomplete)).toThrow(/OPERATOR_JWT_SECRET/);
  });

  it('applies defaults for origins and the Monday token', () => {
    const config = loadConfig(validEnv);
    expect(config.panelOrigin).toBe('http://localhost:5173');
    expect(config.backofficeOrigin).toBe('http://localhost:5174');
    expect(config.mondayApiToken).toBe('');
  });
});
