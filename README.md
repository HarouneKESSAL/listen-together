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
- Rooms run on a self-hosted [metroserver](https://github.com/MetrolistGroup/metroserver), the open-source Listen Together server used by Metrolist, over its WebSocket/protobuf protocol.
- Search uses YouTube Music's web API through a small proxy on the same machine as the room server, because browsers can't call that API directly.
- The room server and search proxy run on the host's own PC. When that PC is off, the page loads but can't connect.

Metrolist app users can join the same rooms by setting a custom Listen Together server in the app to the room server's `wss://…/ws` address.

## Notes

- The UI follows the look of the Metrolist desktop app (Material 3 Expressive, colors taken from the album art).
- Search uses YouTube's unofficial API. Some videos can't be played in embedded players; the host skips those automatically.
