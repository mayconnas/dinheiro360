# ─────────────────────────────────────────────────────────────
# Gestor Financeiro 360 — imagem de produção (Next.js standalone)
# Multi-stage: deps → build → runner enxuto.
#
# Build args de rastreabilidade (preenchidos pelo workflow de deploy):
#   GIT_SHA      — commit que gerou a imagem (exposto em /api/health)
#   APP_VERSION  — versão/tag (ex.: v1.2.3; "dev" em builds locais)
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# As NEXT_PUBLIC_* são embutidas no bundle no build (precisam existir aqui).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
# Visíveis durante o `next build` (ex.: para um build id ou release de monitoramento).
ARG GIT_SHA=""
ARG APP_VERSION=dev
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Rastreabilidade em runtime — lidas pelo /api/health.
ARG GIT_SHA=""
ARG APP_VERSION=dev
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION

# Metadados OCI (o workflow de deploy também injeta os seus via metadata-action).
ARG SOURCE_URL=""
LABEL org.opencontainers.image.title="Gestor Financeiro 360" \
      org.opencontainers.image.description="Gestão financeira 360 — Next.js + Supabase" \
      org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.version=$APP_VERSION

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# artefatos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Health check do container: /api/health devolve 503 quando o banco não
# responde (ou a service role não está configurada) → task "unhealthy".
# wget é o do busybox, já presente na imagem alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/api/health?probe=live" || exit 1

CMD ["node", "server.js"]
