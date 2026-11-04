-- Aditiva: invalida sessões abertas na troca/redefinição de senha.
-- Tokens com iat anterior a passwordChangedAt recebem 401 (app.authenticate).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);
