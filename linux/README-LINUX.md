# HoopsHype NBA Quiz Live on a Linux server

One Docker container runs the whole quiz and streams it to TikTok LIVE. There's no Windows and no TikTok LIVE Studio. The container is separate from anything else on the server, so an existing YouTube stream is untouched.

How it works inside the container:

- Xvfb draws an invisible 1080x1920 screen.
- Chromium shows the quiz full-screen on it.
- The Node bridge reads the TikTok chat, gifts and likes of `TIKTOK_USERNAME`. It reads the public LIVE, so no login is needed.
- ffmpeg encodes the screen and pushes it to TikTok over RTMP.

Each piece restarts on its own if it dies. Questions are pulled from GitHub when the quiz starts and every hour after, so the daily question rebuild needs no action on the server.

## Needs

- Docker with the compose plugin.
- About 1.5 to 2 free vCPUs and 2 GB of RAM at 1080x1920 30fps. A test on 2 vCPUs used about half a core while idle and more during animations. For a smaller server, set `STREAM_SIZE=720x1280`.
- Upload of about 5 Mbps.
- A TikTok stream key for @hoopshype: a server URL plus key from TikTok's LIVE creator tools. Some accounts get a new key for every LIVE. If that's the case here, update `STREAM_KEY` and restart before each stream.

## First run

```bash
git clone https://github.com/jsierrahoopshype/hoopshype-quiz-live.git
cd hoopshype-quiz-live
cp linux/quiz.env.example linux/quiz.env      # MODE=preview by default
mkdir -p saved recap-cards
docker compose -f linux/docker-compose.yml up -d --build
docker compose -f linux/docker-compose.yml logs -f
```

With `MODE=preview`, the quiz plays with fake chat and records 60 seconds to `saved/preview.mp4`. Watch that file to check the picture.

## Going live

1. In `linux/quiz.env`, set `MODE=live` and fill in `RTMP_URL` and `STREAM_KEY`.
2. Run `docker compose -f linux/docker-compose.yml up -d`.
3. Check the logs. You should see "streaming to TikTok" and, once TikTok shows the stream as LIVE, the bridge connecting to @hoopshype's chat.
4. To stop, run `docker compose -f linux/docker-compose.yml down`.

`MODE=practice` streams with fake chat, which is useful for a private test LIVE.

## Updating

```bash
git pull && docker compose -f linux/docker-compose.yml up -d --build
```

This only matters when the screen or engine changes. Question updates arrive on their own.

## Notes

- Standings, trophies and predictions live in `saved/`, and recap images in `recap-cards/`. Both are mounted from the repo folder, so they survive rebuilds.
- The stream has a silent audio track, because TikTok expects one. The quiz's sound effects aren't carried.
- `cpus` in `docker-compose.yml` caps the container at 3 cores so other containers keep their share. Change it with `QUIZ_CPUS=2 docker compose ...`.
- The keyboard shortcuts (pause, skip) need a keyboard on the quiz window, so they don't apply here. The quiz runs on its own.
- `linux/quiz.env` is in `.gitignore`, so the stream key never lands in the repo.
