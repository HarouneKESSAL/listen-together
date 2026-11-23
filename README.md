# Listen Together (web)

> **Unofficial.** This is a fan-made web client. It is not affiliated with, made by, or endorsed by the Metrolist project or its developers.

Listen to music with friends in real time, from a browser. One person hosts a room and controls playback; everyone else hears the same song at the same moment.

**Open it:** https://harounekessal.github.io/listen-together/

## How to use

1. **Host:** open the page, pick a username, press **Host**. Share the room code or the link from the share button.
2. **Join:** open the shared link (or enter the 8-character code) and press **Join**. The host approves you.
3. **Search** for songs and videos from the top bar.
   - The host plays a result right away or adds it to the queue.
   - Guests suggest songs; the host approves or rejects them. Approved songs go next in the queue, and start right away if nothing is playing.
   - **Albums**, **Playlists** and **Artists** filters: the host plays a whole album/playlist or an artist's top songs, or adds them all to the queue.
4. **Lyrics** scroll in time with the song for everyone (from [LRCLIB](https://lrclib.net)). The host can tap a line to jump there.
5. **Queue:** tap an upcoming song to play it now (the rest stays queued); *Recently played* lets you replay or re-suggest songs.
6. **Endless radio** (host, on by default in the queue panel): when the last queued song starts, similar songs are queued so the music keeps going.
7. **Invite:** the share button opens your phone's share menu; **QR code** under the room code lets people in the same room scan to join.
8. **Hand over control:** the host can tap a participant and choose **Make host**.

**Install it as an app:** on Android (Chrome) or a computer, tap **Install app** on the start screen. On iPhone/iPad, open the link in Safari, tap Share, then **Add to Home Screen**.

**Chat:** everyone in the room can chat (only approved members; messages aren't saved and disappear when the room ends). Chat is our addition to the room server, so Metrolist app users don't see it.

**Playlists:** save the queue or any song to your own playlists (stored on your device), and play or queue them in any room you host. Paste a YouTube or YouTube Music playlist/album link into search to play it. **Spotify** public playlist and album links work too: Spotify's audio can't play outside Spotify, so each song is found on YouTube Music (first 100 songs; the odd remix or obscure track may be missing). This reads Spotify's public embed pages, so it can break if Spotify changes them. The host can also switch on **Let everyone add songs** in the queue panel, so guests' picks go straight into the queue.

**Your own pause and volume:** guests can pause just for themselves (the room keeps playing; press play to rejoin live), and everyone sets their own volume (on phones, tap the speaker icon; iPhones use the side buttons). If the host's phone locks, the room keeps playing and the host rejoins when they come back.

**Keyboard shortcuts** (computers): Space/K play-pause, ←/→ back/ahead 10 s, N next song, M mute, Q queue, / search. Playback keys work for the host only.

Playback goes through YouTube's embedded player, so press play once if your browser blocks autoplay.

## How it works

- `index.html` is the whole client: a single static page, no build step.
- `server.js` is a dependency-free Node server: serves the page, proxies search, and forwards rooms to metroserver.
- Rooms run on a self-hosted [metroserver](https://github.com/MetrolistGroup/metroserver), the open-source Listen Together server used by Metrolist, over its WebSocket/protobuf protocol.
- Room chat is added on top of metroserver by `metroserver-chat/` (two proto messages + a Go handler with tests), applied by the `Dockerfile` at build time. Clients only get chat if they ask for the `chat` feature, so the Metrolist app is unaffected.
- Search uses YouTube Music's web API through a small proxy on the same machine as the room server, because browsers can't call that API directly.
- The room server and search proxy run together in one container on Render's free plan (see below). The first visit after a quiet spell can take up to a minute while it wakes.

Metrolist app users can join the same rooms by setting a custom Listen Together server in the app to the room server's `wss://…/ws` address.

## Host it free (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/HarouneKESSAL/listen-together)

The `Dockerfile` bundles metroserver and `server.js` into one container; `render.yaml` deploys it on Render's free plan. Everything (page, search, rooms) is served from the one `onrender.com` address, and pushes to `main` redeploy automatically.

To keep it awake, point a free uptime monitor (e.g. UptimeRobot, every 5 minutes) at `https://<your-service>.onrender.com/health`. It returns 503 if the room server is down, so the monitor also emails you about outages.

Free-plan limits: the service sleeps after about 15 minutes with no traffic. The next visitor wakes it, which takes up to a minute, and rooms that were open when it went to sleep are gone. Rooms also end whenever the server restarts (every push redeploys it). The host's device remembers the song, position and queue, and the start screen offers **Start a room with this music** to carry on; friends join with the new code.

## Run it yourself

Needs [Node.js](https://nodejs.org) 18+ and [Docker](https://www.docker.com).

1. Start a metroserver on port 8080:
   ```sh
   git clone https://github.com/MetrolistGroup/metroserver
   cd metroserver
   docker build -t metroserver .
   docker run -d --name metroserver -p 8080:8080 metroserver
   ```
2. In this repo, start the page + proxy (no `npm install` needed, it has no dependencies):
   ```sh
   node server.js
   ```
3. Open http://localhost:5500. Friends on the same Wi-Fi can use `http://<your-PC-IP>:5500`.

`server.js` serves the page, proxies search (`/api/search`, `/api/suggest`), and forwards `/ws` to metroserver, so one address covers everything. To let friends outside your network in, put that one address behind a tunnel such as Cloudflare Tunnel or ngrok.

| Setting | Default | |
|---|---|---|
| `PORT` | `5500` | Port for the page and proxy |
| `METROSERVER` | `localhost:8080` | Where `/ws` is forwarded |

On Windows, if the Docker build fails in `generate_proto.sh`, convert metroserver's `scripts/*.sh` to LF line endings first.

On Windows, after the one-time build in step 1, `start.cmd` starts everything in one go (the `metroserver` container, `server.js`, and an ngrok tunnel). It has this deployment's ngrok domain hard-coded; replace it with your own, or drop the ngrok line if you only need local/Wi-Fi access.

The proxy has no rate limiting or caching, so only share its address with people you trust.

## Notes

- The UI follows the look of the Metrolist desktop app (Material 3 Expressive, colors taken from the album art).
- Search uses YouTube's unofficial API. Some videos can't be played in embedded players; the host skips those automatically.
