FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/pii/package.json packages/pii/
COPY packages/entitlements/package.json packages/entitlements/
COPY packages/secrets/package.json packages/secrets/
COPY packages/uappi-client/package.json packages/uappi-client/
COPY packages/connectors/package.json packages/connectors/
COPY packages/mcp-core/package.json packages/mcp-core/
COPY packages/mcp-commerce/package.json packages/mcp-commerce/
COPY packages/mcp-ga4/package.json packages/mcp-ga4/
COPY packages/mcp-behavior/package.json packages/mcp-behavior/
COPY packages/mcp-firebase/package.json packages/mcp-firebase/
COPY packages/mcp-quality/package.json packages/mcp-quality/
COPY packages/mcp-sprint/package.json packages/mcp-sprint/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/backoffice/package.json apps/backoffice/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Endereço absoluto da API que o back-office chama; é embutido no bundle em tempo de build.
ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN pnpm --filter @center/api exec prisma generate
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
# Entrypoint padrão: API. Os workers sobrescrevem o command no compose.
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

# Back-office da Blan: SPA estática servida por nginx (admin.<domínio>).
FROM nginx:1.27-alpine AS backoffice
COPY apps/backoffice/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/backoffice/dist /usr/share/nginx/html
EXPOSE 80
