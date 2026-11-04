import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

function modelBody(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

describe('prisma schema invariants', () => {
  it('Organization holds no integration columns', () => {
    expect(modelBody('Organization')).not.toMatch(/uappi|ga4|playConsole|appStoreConnect|monday|statusMapping/i);
  });

  it('slug is required', () => {
    expect(modelBody('Organization')).toMatch(/slug\s+String\s+@unique/);
  });

  it('keeps the order natural key unique per organization', () => {
    expect(modelBody('CommerceOrder')).toMatch(/@@unique\(\[organizationId, numeroPedido\]\)/);
  });

  it('keeps the customer natural key unique per organization', () => {
    expect(modelBody('CommerceCustomer')).toMatch(/@@unique\(\[organizationId, externalId\]\)/);
  });

  it('stores money as integer cents, never Float or Decimal', () => {
    const order = modelBody('CommerceOrder');
    for (const field of ['subtotalCents', 'freightCents', 'discountCents', 'totalCents']) {
      expect(order).toMatch(new RegExp(`${field}\\s+Int`));
    }
    expect(order).not.toMatch(/Float/);
  });

  it('has no column capable of holding personal data in the clear', () => {
    const forbidden = /\b(email|documento|document|cpf|cnpj|clientId|client_id|phone)\s+String/i;
    for (const model of ['CommerceOrder', 'CommerceCustomer', 'AttributionTouch']) {
      const body = modelBody(model);
      const offending = body.split('\n').filter((line) => forbidden.test(line));
      expect(offending).toEqual([]);
    }
  });

  it('only exposes hashed identifiers on customer and attribution', () => {
    expect(modelBody('CommerceCustomer')).toMatch(/emailHash\s+String\?/);
    expect(modelBody('CommerceCustomer')).toMatch(/documentHash\s+String\?/);
    expect(modelBody('AttributionTouch')).toMatch(/visitorHash\s+String/);
  });

  it('keeps the webhook idempotency key as a primary key', () => {
    expect(modelBody('ProcessedWebhookEvent')).toMatch(/wamid\s+String\s+@id/);
  });

  it('scopes every tenant-owned model to an organization', () => {
    for (const model of [
      'CommerceOrder', 'CommerceOrderItem', 'CommerceCustomer',
      'AttributionTouch', 'SyncState', 'WhatsAppIdentity', 'Conversation', 'ToolCallLog',
    ]) {
      expect(modelBody(model)).toMatch(/organizationId\s+String/);
    }
  });

  it('indexes the columns the analytics queries filter on', () => {
    expect(modelBody('CommerceOrder')).toMatch(/@@index\(\[organizationId, emittedAt\]\)/);
    expect(modelBody('CommerceOrder')).toMatch(/@@index\(\[organizationId, statusGroup, emittedAt\]\)/);
    expect(modelBody('CommerceOrderItem')).toMatch(/@@index\(\[organizationId, sku, emittedAt\]\)/);
  });

  it('keeps one integration per organization and kind', () => {
    expect(modelBody('Integration')).toMatch(/@@unique\(\[organizationId, kind\]\)/);
  });

  it('keeps one contract per organization and module', () => {
    expect(modelBody('OrganizationModule')).toMatch(/@@unique\(\[organizationId, moduleKey\]\)/);
  });

  it('Role enum has MEMBER and no VIEWER', () => {
    const body = schema.match(/enum Role \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(body).toMatch(/\bMEMBER\b/);
    expect(body).not.toMatch(/VIEWER/);
  });

  it('platform operators are a separate model and User has no operator flag', () => {
    expect(schema).toMatch(/model PlatformOperator \{/);
    expect(modelBody('User')).not.toMatch(/superadmin|operator|isPlatform/i);
  });

  it('Integration has no plaintext credential columns', () => {
    expect(modelBody('Integration')).not.toMatch(/apiKey|secretKey|token\s+String/i);
  });

  it('drop migration guards against uncopied legacy integrations before altering', () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20261115000000_drop_legacy_org_integration_columns/migration.sql'),
      'utf8',
    );
    const alter = sql.indexOf('ALTER TABLE');
    const slugGuard = sql.indexOf('"slug" IS NULL');
    const copyGuard = sql.indexOf('integração legada não copiada');
    expect(slugGuard).toBeGreaterThan(-1);
    expect(copyGuard).toBeGreaterThan(slugGuard);
    expect(alter).toBeGreaterThan(copyGuard);
    for (const kind of ['COMMERCE', 'WEB_ANALYTICS', 'APP_ANALYTICS', 'PLAY_STORE', 'APP_STORE', 'SPRINT_BOARD']) {
      expect(sql).toContain(`i."kind" = '${kind}'`);
    }
    expect(sql).not.toMatch(/mondayApiToken" IS NOT NULL|statusMapping" IS NOT NULL/);
  });
});
