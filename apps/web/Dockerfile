FROM node:22-slim AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json

FROM base AS deps
RUN npm ci --workspace @filler/shared --workspace @filler/web --include-workspace-root

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
WORKDIR /repo/apps/web
RUN npm run build

FROM base AS prod-deps
RUN npm ci --workspace @filler/shared --workspace @filler/web --include-workspace-root --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN groupadd --system app && useradd --system --gid app --home-dir /repo app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/package.json ./package.json
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/web/package.json apps/web/package.json
COPY --from=build /repo/apps/web/server.js apps/web/server.js
COPY --from=build /repo/apps/web/dist apps/web/dist
WORKDIR /repo/apps/web
USER app
EXPOSE 8080
CMD ["node", "server.js"]
