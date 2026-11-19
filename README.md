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

Playback goes through YouTube's embedded player, so press play once if your browser blocks autoplay.

## How it works

- `index.html` is the whole client: a single static page, no build step.
- `server.js` is a dependency-free Node server: serves the page, proxies search, and forwards rooms to metroserver.
- Rooms run on a self-hosted [metroserver](https://github.com/MetrolistGroup/metroserver), the open-source Listen Together server used by Metrolist, over its WebSocket/protobuf protocol.
- Search uses YouTube Music's web API through a small proxy on the same machine as the room server, because browsers can't call that API directly.
- The room server and search proxy run on the host's own PC. When that PC is off, the page loads but can't connect.

Metrolist app users can join the same rooms by setting a custom Listen Together server in the app to the room server's `wss://…/ws` address.

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

The proxy has no rate limiting or caching, so only share its address with people you trust.

## Notes

- The UI follows the look of the Metrolist desktop app (Material 3 Expressive, colors taken from the album art).
- Search uses YouTube's unofficial API. Some videos can't be played in embedded players; the host skips those automatically.
