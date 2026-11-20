// Serves the web client and proxies YouTube Music search (browsers can't call InnerTube directly: CORS).
// Same endpoints and client the Metrolist apps use (innertubex, WEB_REMIX). Run: node server.js
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT) || 5500;
const PAGE = new URL('./index.html', import.meta.url);
// App-install files next to the page (fixed list: nothing else on disk is reachable).
const STATIC = {
  '/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'text/javascript; charset=utf-8',
  '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/apple-touch-icon.png': 'image/png',
};
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'en', gl: 'US' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const FILTERS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D', videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D', playlists: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
};
const MAX_COLLECTION_TRACKS = 100;

async function innertube(endpoint, body) {
  const r = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://music.youtube.com', referer: 'https://music.youtube.com/', 'user-agent': UA },
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`InnerTube ${endpoint}: HTTP ${r.status}`);
  return r.json();
}

// Every musicResponsiveListItemRenderer anywhere in the response, in order.
function listItems(node, out = []) {
  if (Array.isArray(node)) node.forEach(n => listItems(n, out));
  else if (node && typeof node === 'object') {
    if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
    else Object.values(node).forEach(n => listItems(n, out));
  }
  return out;
}

const runsText = col => (col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(r => r.text).join('');
const TYPE_LABELS = new Set(['Song', 'Video', 'Episode']);

// -> TrackInfo shape used by the Listen Together protocol (duration in ms), or null for non-playable rows.
function toTrack(r) {
  const id = r.playlistItemData?.videoId
    || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!id) return null;
  const parts = runsText(r.flexColumns?.[1]).split(' • ').map(s => s.trim()).filter(Boolean);
  const kind = TYPE_LABELS.has(parts[0]) ? parts.shift() : '';
  const toMs = s => s.split(':').reduce((a, n) => a * 60 + +n, 0) * 1000;
  const isTime = s => /^\d+(:\d{2}){1,2}$/.test(s || '');
  let duration = 0;
  if (isTime(parts.at(-1))) duration = toMs(parts.pop());
  // Album/playlist pages put the length in a fixed column instead.
  const fixed = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
  if (!duration && isTime(fixed)) duration = toMs(fixed);
  if (/views?$|plays?$/i.test(parts.at(-1) || '')) parts.pop();
  const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  return {
    id,
    title: runsText(r.flexColumns?.[0]),
    artist: parts[0] || '',
    album: parts[1] || runsText(r.flexColumns?.[2]),
    kind,   // "Song" / "Video" when YouTube labels it; not part of the protocol's TrackInfo
    duration,
    // Googleusercontent art is resizable; ask for a size good enough for the player bar and theming.
    thumbnail: (thumbs.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`).replace(/=w\d+-h\d+.*$/, '=w544-h544'),
  };
}

const bigArt = url => url?.replace(/=w\d+-h\d+.*$/, '=w544-h544');

// Album / playlist search row -> { playlistId, title, subtitle, thumbnail }, or null.
function toCollection(r) {
  const playlistId = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
    ?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;
  if (!playlistId) return null;
  return {
    playlistId,
    title: runsText(r.flexColumns?.[0]),
    subtitle: runsText(r.flexColumns?.[1]),   // "Album • Daft Punk • 2013" / "Owner • 5.9M views"
    thumbnail: bigArt(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url) || '',
  };
}

async function search(q, type) {
  const res = await innertube('search', { query: q, params: FILTERS[type] });
  const rows = listItems(res);
  return (type === 'albums' || type === 'playlists' ? rows.map(toCollection) : rows.map(toTrack)).filter(Boolean);
}

// Tracks of an album or playlist from its page. ('browse', like search, works from cloud hosts; 'next' gets refused there.)
// Limitation: first page only (~100 tracks); follow continuations if longer playlists matter.
async function collection(playlistId) {
  const res = await innertube('browse', { browseId: 'VL' + playlistId });
  const seen = new Set();
  return listItems(res).map(toTrack).filter(t => t && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_COLLECTION_TRACKS);
}

async function suggest(q) {
  const res = await innertube('music/get_search_suggestions', { input: q });
  const sections = res.contents || [];
  const queries = (sections[0]?.searchSuggestionsSectionRenderer?.contents || [])
    .map(c => (c.searchSuggestionRenderer?.suggestion?.runs || []).map(r => r.text).join(''))
    .filter(Boolean);
  return { queries, items: listItems(sections.slice(1)).map(toTrack).filter(Boolean) };
}

// The GitHub Pages copy of the page calls the API cross-origin. Read-only public search, so any origin is fine.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'ngrok-skip-browser-warning' };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(await readFile(PAGE));
    }
    if (Object.hasOwn(STATIC, url.pathname)) {
      res.writeHead(200, { 'content-type': STATIC[url.pathname], 'cache-control': 'no-cache' });
      return res.end(await readFile(new URL('.' + url.pathname, import.meta.url)));
    }
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    if (url.pathname === '/api/search') {
      const type = Object.hasOwn(FILTERS, url.searchParams.get('type')) ? url.searchParams.get('type') : 'songs';
      return json(res, 200, q ? await search(q, type) : []);
    }
    if (url.pathname === '/api/collection') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]{2,80}$/.test(id)) return json(res, 400, { error: 'Bad playlist id' });
      return json(res, 200, await collection(id));
    }
    if (url.pathname === '/api/suggest') return json(res, 200, q ? await suggest(q) : { queries: [], items: [] });
    res.writeHead(404).end();
  } catch (err) {
    console.error(err.message);
    json(res, 502, { error: 'Search is unavailable right now' });
  }
});

// Pass /ws WebSocket upgrades straight through to metroserver, so one origin (and one tunnel) serves page + rooms.
const [WS_HOST, WS_PORT] = (process.env.METROSERVER || 'localhost:8080').split(':');
server.on('upgrade', (req, sock, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return sock.destroy();
  const up = net.connect(+WS_PORT, WS_HOST, () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});

server.listen(PORT, '0.0.0.0', () => console.log(`Listen Together web: http://localhost:${PORT}`));
// Limitation: no rate limiting or caching; add both before exposing this beyond your own network.
