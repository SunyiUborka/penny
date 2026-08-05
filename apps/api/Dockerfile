FROM node:22-slim AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json

FROM base AS deps
RUN npm ci --workspace @filler/shared --workspace @filler/api --include-workspace-root

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN groupadd --system app && useradd --system --gid app --home-dir /repo app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/api apps/api
WORKDIR /repo/apps/api
USER app
EXPOSE 3000
CMD ["node", "src/index.js"]
