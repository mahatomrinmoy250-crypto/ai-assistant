# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma's query engine (libquery_engine-linux-musl.so.node)
RUN apk add --no-cache openssl

# Install dependencies (dev + prod) for compilation
COPY package*.json ./
RUN npm ci

# Generate Prisma client before compiling TypeScript
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# wget = Docker health check, openssl = Prisma query engine runtime dependency
RUN apk add --no-cache wget openssl

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and Prisma artefacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Prisma schema is required at runtime for migrate deploy
COPY prisma ./prisma

RUN mkdir -p logs

EXPOSE 3001

CMD ["node", "dist/index.js"]
