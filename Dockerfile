# ============================================
# K-PATROL BACKEND - DOCKER BUILD
# ============================================

# Build stage
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies only when needed
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install -g pnpm && \
    pnpm install --no-frozen-lockfile

# Builder stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm install -g pnpm && \
    pnpm build

# Remove dev dependencies
RUN pnpm prune --prod

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install wget for healthcheck + openssl for Prisma on Alpine
RUN apk add --no-cache wget openssl

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy necessary files from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
# V5.15c9: bundle K-Patrol logo + branded assets so EmailChannel can attach
# them inline via CID. Embedded at build time (no runtime fetch) so emails
# render the brand even when the recipient is offline / has remote images
# blocked by default.
COPY --from=builder --chown=nestjs:nodejs /app/assets ./assets

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 4000

ENV PORT=4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

# Start: sync DB schema (idempotent) then launch app
CMD ["sh", "-c", "node_modules/.bin/prisma db push --skip-generate --accept-data-loss && node dist/main.js"]
