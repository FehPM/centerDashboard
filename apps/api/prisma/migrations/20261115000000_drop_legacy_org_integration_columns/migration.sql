DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Organization" WHERE "slug" IS NULL) THEN
    RAISE EXCEPTION 'rode migrate-to-multitenant antes desta migração';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Organization" o WHERE
      (o."uappiApiKey" IS NOT NULL AND o."uappiSecretKey" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'COMMERCE'))
      OR (o."ga4PropertyId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'WEB_ANALYTICS'))
      OR (o."ga4AppPropertyId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'APP_ANALYTICS'))
      OR (o."playConsoleCredsJson" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'PLAY_STORE'))
      OR (o."appStoreConnectKeyJson" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'APP_STORE'))
      OR (o."mondayBoardId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = o."id" AND i."kind" = 'SPRINT_BOARD'))
  ) THEN
    RAISE EXCEPTION 'há integração legada não copiada para "Integration"; rode migrate-to-multitenant (com a chave correta) antes desta migração';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "appStoreConnectKeyJson",
DROP COLUMN "ga4AppPropertyId",
DROP COLUMN "ga4BigQueryDataset",
DROP COLUMN "ga4PropertyId",
DROP COLUMN "mondayApiToken",
DROP COLUMN "mondayBoardId",
DROP COLUMN "playConsoleCredsJson",
DROP COLUMN "statusMapping",
DROP COLUMN "uappiApiKey",
DROP COLUMN "uappiSecretKey",
ALTER COLUMN "slug" SET NOT NULL;
