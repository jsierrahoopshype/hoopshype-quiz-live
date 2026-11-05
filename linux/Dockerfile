# HoopsHype NBA Quiz Live, Linux version: one container that runs the quiz in an invisible
# browser and streams it to TikTok LIVE over RTMP (no Windows, no TikTok LIVE Studio).
#
#   docker compose -f linux/docker-compose.yml up -d --build
#
# Inside: Xvfb (a virtual 1080x1920 screen) -> Chromium showing the quiz -> ffmpeg -> TikTok.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb ffmpeg fonts-dejavu-core ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /quiz
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN chmod +x linux/entrypoint.sh

# saved/ holds the standings, trophies and recap cards: mount it so they survive restarts
VOLUME ["/quiz/saved", "/quiz/recap-cards"]
ENTRYPOINT ["/usr/bin/tini", "--", "/quiz/linux/entrypoint.sh"]
