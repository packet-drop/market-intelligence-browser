# Build stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files
COPY package*.json ./

# Install production dependencies without downloading browsers in npm lifecycle
RUN mkdir -p /ms-playwright
RUN if [ -f package-lock.json ]; then PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev; else PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev; fi

# Install the Chromium revision that matches the installed Playwright package
RUN node ./node_modules/playwright/cli.js install --with-deps chromium

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodejs \
    && mkdir -p /ms-playwright /data \
    && chown -R nodejs:nodejs /app /ms-playwright /data

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "dist/index.js"]
