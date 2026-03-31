# ============================================================
# synkolab-emergency — Docker Image
# ============================================================
# Build: docker build -t synkolab-emergency .
# Run:   docker compose up -d
# ============================================================

FROM node:22-alpine

RUN apk add --no-cache tini python3 make g++
WORKDIR /app

# Install dependencies (native addons need build tools)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy pre-built dist (run `npm run build` before docker build)
COPY dist ./dist

# Create data & certs directories
RUN mkdir -p /app/data /app/certs && chown -R node:node /app

# Cleanup build tools to reduce image size
RUN apk del python3 make g++

USER node

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/app/data/emergency.db

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
