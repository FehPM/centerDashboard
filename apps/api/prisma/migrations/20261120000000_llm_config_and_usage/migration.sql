-- AlterEnum
ALTER TYPE "IntegrationKind" ADD VALUE 'LLM';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'ANTHROPIC';

-- CreateEnum
CREATE TYPE "LlmMode" AS ENUM ('OWN', 'MANAGED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "llmKeyLabel" TEXT,
ADD COLUMN     "llmMode" "LlmMode";
