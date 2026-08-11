# Produktions-Image für Coolify (Phase 7). Nutzt Next.js' "standalone"-
# Output (next.config.mjs: output: "standalone") — das Ergebnis-Image
# enthält nur die node_modules, die zur Laufzeit tatsächlich gebraucht
# werden, statt des kompletten node_modules-Baums.

FROM node:20-alpine AS base

# ---------------------------------------------------------------------
# deps: nur die Abhängigkeiten installieren, separate Stage für Docker-
# Layer-Caching (ändert sich seltener als der Quellcode).
# ---------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------
# builder: Produktions-Build erzeugen.
# NEXT_PUBLIC_*-Variablen müssen bereits beim Build im Bundle stehen
# (Next.js baut sie zur Build-Zeit in den Client-Code ein) — deshalb als
# Build-Argumente, in Coolify unter "Build Variables" zu setzen, nicht nur
# als normale Laufzeit-Umgebungsvariablen.
# ---------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------
# runner: schlankes Laufzeit-Image, läuft nicht als root.
# ---------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Coolify fragt /api/health ab (siehe app/api/health/route.ts).
CMD ["node", "server.js"]
