# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# fontconfig + a basic TrueType font let sharp/librsvg render ECharts SVG text
# cleanly when converting server-side SVG charts to PNG/WebP.
RUN apk add --no-cache fontconfig ttf-dejavu

COPY package*.json ./
RUN npm ci \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY wdio.conf.js tsconfig.json ./
COPY test ./test

EXPOSE 3000

CMD ["node", "dist/server.js"]
