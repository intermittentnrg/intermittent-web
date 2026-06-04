# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# fontconfig + a basic TrueType font let server-side ECharts/canvas rendering
# produce readable chart text, and ffmpeg stitches price-map frames into video.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# GPU acceleration for skia-canvas
RUN groupadd -g 109 render && usermod -aG video,render node

COPY package*.json ./
RUN npm ci --include=dev \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY vitest.config.ts wdio.conf.js tsconfig.json jobdsl.groovy ./
COPY test ./test

EXPOSE 3000

CMD ["node", "--experimental-strip-types", "src/server.ts"]
