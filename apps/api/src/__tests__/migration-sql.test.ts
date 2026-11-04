import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '../../prisma/migrations/20261030000000_multitenant_foundation/migration.sql'),
  'utf8',
);

describe('multitenant_foundation migration', () => {
  it('renames VIEWER to MEMBER in place', () => {
    expect(sql).toContain(`ALTER TYPE "Role" RENAME VALUE 'VIEWER' TO 'MEMBER'`);
  });

  it('makes the audit log append-only', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "OperatorAuditLog"');
  });

  it('drops nothing', () => {
    expect(sql).not.toContain('DROP COLUMN');
    expect(sql).not.toContain('DROP TABLE');
  });
});

describe('user_password_changed_at migration', () => {
  const additive = readFileSync(
    join(__dirname, '../../prisma/migrations/20261116000000_user_password_changed_at/migration.sql'),
    'utf8',
  );

  it('only adds the nullable passwordChangedAt column', () => {
    expect(additive).toContain('ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);');
    expect(additive).not.toMatch(/DROP|NOT NULL|UPDATE /);
  });
});
