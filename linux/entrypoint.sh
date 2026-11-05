#!/bin/bash
# Starts the virtual screen, the chat bridge, the quiz browser and the stream, and restarts
# whichever piece dies. Settings come from environment variables (see linux/quiz.env.example).
set -u
W=${QUIZ_WIDTH:-1080}; H=${QUIZ_HEIGHT:-1920}          # the page is designed at 1080x1920
OUT=${STREAM_SIZE:-1080x1920}                          # 720x1280 halves the CPU needed
FPS=${STREAM_FPS:-30}
VBR=${VIDEO_KBPS:-4500}
MODE=${MODE:-live}                                     # live | practice | preview
URL="http://localhost:8787/"
[ "$MODE" != "live" ] && URL="http://localhost:8787/?practice=1"
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# 1. virtual screen
Xvfb :99 -screen 0 ${W}x${H}x24 -nolisten tcp &
export DISPLAY=:99
sleep 1

# 2. chat bridge (also serves the quiz page on port 8787 inside the container)
( while true; do
    if [ "$MODE" = "live" ]; then node bridge/quiz-bridge.mjs; else node bridge/quiz-bridge.mjs practice; fi
    log "bridge stopped, restarting in 5s"; sleep 5
  done ) &
for i in $(seq 1 60); do curl -sf "$URL" >/dev/null && break; sleep 1; done

# 3. the quiz, full screen in Chromium (--no-sandbox is needed inside Docker; it only opens our own page)
( while true; do
    ${CHROMIUM:-chromium} --no-sandbox --test-type --disable-infobars --noerrdialogs --hide-scrollbars \
      --disable-session-crashed-bubble --no-first-run --disable-gpu --disable-dev-shm-usage --kiosk \
      --window-position=0,0 --window-size=${W},${H} --autoplay-policy=no-user-gesture-required \
      --user-data-dir=/tmp/quiz-chrome "$URL" >/dev/null 2>&1
    log "browser stopped, restarting in 3s"; sleep 3
  done ) &
sleep 8

# 4. stream (or record a 60-second test file with MODE=preview)
ENC=(-c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -r "$FPS" -g $((FPS * 2))
     -b:v ${VBR}k -maxrate ${VBR}k -bufsize $((VBR * 2))k -c:a aac -b:a 128k -ar 44100)
IN=(-thread_queue_size 512 -f x11grab -draw_mouse 0 -video_size ${W}x${H} -framerate "$FPS" -i :99
    -thread_queue_size 512 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100)   # silent track: TikTok expects audio
SCALE=(-vf "scale=${OUT/x/:}")

if [ "$MODE" = "preview" ]; then
  log "recording a ${PREVIEW_SECS:-60}-second preview to saved/preview.mp4"
  ffmpeg -hide_banner -loglevel warning -y "${IN[@]}" "${SCALE[@]}" "${ENC[@]}" -t "${PREVIEW_SECS:-60}" saved/preview.mp4
  log "preview done: saved/preview.mp4"
  sleep infinity
fi

if [ -z "${RTMP_URL:-}" ] || [ -z "${STREAM_KEY:-}" ]; then
  log "RTMP_URL or STREAM_KEY is empty: the quiz runs but nothing is streamed. Fill them in quiz.env."
  sleep infinity
fi
while true; do
  log "streaming to TikTok"
  ffmpeg -hide_banner -loglevel warning "${IN[@]}" "${SCALE[@]}" "${ENC[@]}" -f flv "${RTMP_URL%/}/${STREAM_KEY}"
  log "stream dropped, reconnecting in 10s"; sleep 10
done
