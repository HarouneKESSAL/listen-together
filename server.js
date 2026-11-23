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
  artists: 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D',
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

// Artist search row -> { artistId, title, subtitle, thumbnail }, or null.
function toArtist(r) {
  const artistId = r.navigationEndpoint?.browseEndpoint?.browseId;
  if (!/^UC[\w-]+$/.test(artistId || '')) return null;
  return {
    artistId,
    title: runsText(r.flexColumns?.[0]),
    subtitle: runsText(r.flexColumns?.[1]),   // "Artist • 121M monthly audience"
    thumbnail: bigArt(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url) || '',
  };
}

async function search(q, type) {
  const res = await innertube('search', { query: q, params: FILTERS[type] });
  const rows = listItems(res);
  const toItem = type === 'albums' || type === 'playlists' ? toCollection : type === 'artists' ? toArtist : toTrack;
  return rows.map(toItem).filter(Boolean);
}

// An artist's top songs: the "Top songs" shelf on their page links to the full list as a playlist.
async function artistSongs(artistId) {
  const page = await innertube('browse', { browseId: artistId });
  let all = '';
  (function walk(n) {
    if (all || !n || typeof n !== 'object') return;
    const id = n.musicShelfRenderer?.bottomEndpoint?.browseEndpoint?.browseId;
    if (id?.startsWith('VL')) all = id.slice(2);
    else Object.values(n).forEach(walk);
  })(page);
  if (all) { const { tracks } = await collection(all); if (tracks.length) return tracks; }
  return listItems(page).map(toTrack).filter(Boolean);   // fall back to the few songs shown on the page
}

// Songs like this one, for endless radio. YouTube Music's own radio ('next' + RDAMVM playlist) when the
// host network allows it; otherwise (cloud IPs get refused) the artist's top songs.
let radioRefusedUntil = 0;   // after a refusal, skip straight to the fallback for a while (each refusal costs seconds)
async function radio(id, artist) {
  if (Date.now() > radioRefusedUntil) try {
    const res = await innertube('next', { videoId: id, playlistId: 'RDAMVM' + id, isAudioOnly: true, enablePersistentPlaylistPanel: true });
    const panel = [];
    (function walk(n) {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') n.playlistPanelVideoRenderer ? panel.push(n.playlistPanelVideoRenderer) : Object.values(n).forEach(walk);
    })(res);
    const tracks = panel.filter(v => v.videoId && v.videoId !== id).map(v => {
      const len = v.lengthText?.runs?.[0]?.text || '';
      return {
        id: v.videoId,
        title: (v.title?.runs || []).map(r => r.text).join(''),
        artist: (v.longBylineText?.runs || []).map(r => r.text).join('').split(' • ')[0] || '',
        album: '',
        duration: /^\d+(:\d{2}){1,2}$/.test(len) ? len.split(':').reduce((a, n) => a * 60 + +n, 0) * 1000 : 0,
        thumbnail: bigArt(v.thumbnail?.thumbnails?.at(-1)?.url) || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      };
    });
    if (tracks.length) return { source: 'radio', tracks };
    radioRefusedUntil = Date.now() + 3600_000;
  } catch (err) { console.error('radio:', err.message); radioRefusedUntil = Date.now() + 3600_000; }
  const main = artist.split(/,| & | x | feat\.? /i)[0].trim();
  const found = main ? (await search(main, 'songs')).filter(t => t.id !== id) : [];
  // A name search also matches titles ("Queen" -> "Queen Of The Zoo" by someone else); prefer the artist's own songs.
  const own = found.filter(t => t.artist.toLowerCase().includes(main.toLowerCase()));
  return { source: 'artist', tracks: own.length >= 5 ? own : found };
}

// Tracks of an album or playlist from its page. ('browse', like search, works from cloud hosts; 'next' gets refused there.)
// Limitation: first page only (~100 tracks); follow continuations if longer playlists matter.
async function collection(playlistId) {
  const res = await innertube('browse', { browseId: 'VL' + playlistId });
  const seen = new Set();
  const tracks = listItems(res).map(toTrack).filter(t => t && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_COLLECTION_TRACKS);
  // Playlist pages carry their name in a header (album pages reached this way don't).
  let title = '';
  (function walk(n) {
    if (title || !n || typeof n !== 'object') return;
    if (n.musicResponsiveHeaderRenderer?.title) title = (n.musicResponsiveHeaderRenderer.title.runs || []).map(r => r.text).join('');
    else Object.values(n).forEach(walk);
  })(res);
  return { title, tracks };
}

// ---- Spotify import: read a public playlist/album's song list, then find each song on YouTube Music ----
// Uses the public embed page (no Spotify account or API key). Limitation: unofficial page format; if Spotify
// changes it this breaks, and the fix is the official Web API with a developer app's keys.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
async function spotifyList(type, id) {
  const r = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Spotify embed: HTTP ${r.status}`);
  const m = (await r.text()).match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const entity = m && JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity?.trackList) throw new Error('Spotify embed: no track list');
  // Some responses carry HTML-escaped text ("&amp;"); decode the common entities.
  const text = s => (s || '').replace(/ /g, ' ').replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, e) => ({ amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>' })[e]);
  return {
    title: text(entity.name || entity.title) || 'Spotify playlist',
    tracks: entity.trackList.slice(0, MAX_COLLECTION_TRACKS).map(t => ({
      title: text(t.title), artist: text(t.subtitle), duration: t.duration || 0,
    })).filter(t => t.title),
  };
}

// Best YouTube Music song for a title/artist/duration (ms), or null. Matches are cached (same songs get imported often).
const matchCache = new Map();
const VERSION_WORDS = /\b(demo|live|remix|acoustic|instrumental|karaoke|cover|sped up|slowed|reverb|piano|version|edit|remaster(ed)?)\b/g;
const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function matchSong(title, artist, duration) {
  const key = `${title}\n${artist}\n${Math.round(duration / 5000)}`;
  if (matchCache.has(key)) return matchCache.get(key);
  // "Song - Remastered 2011" / "Song (feat. X)" -> "Song"; first credited artist only.
  const cleanTitle = title.replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, '').replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, '').trim();
  const mainArtist = artist.split(/,| & | x | feat\.? /i)[0].trim();
  const results = (await search(`${cleanTitle} ${mainArtist}`.trim(), 'songs')).slice(0, 5);
  let best = null, bestPenalty = Infinity;
  for (const t of results) {
    const artistOk = mainArtist && norm(t.artist).includes(norm(mainArtist));
    const titleOk = norm(t.title).includes(norm(cleanTitle)) || norm(cleanTitle).includes(norm(t.title));
    const durOff = duration && t.duration ? Math.abs(t.duration - duration) / 1000 : 20;   // seconds; unknown = middling
    // A "demo"/"live"/"remix"… version only fits when the Spotify title asks for one.
    const extra = (norm(t.title).match(VERSION_WORDS) || []).filter(w => !norm(title).includes(w)).length;
    const penalty = (artistOk ? 0 : 30) + (titleOk ? 0 : 20) + Math.min(durOff, 60) + extra * 15;
    if (penalty < bestPenalty) { best = t; bestPenalty = penalty; }
  }
  const match = bestPenalty <= 45 ? best : null;   // e.g. right artist, title and within ~45 s
  if (matchCache.size > 5000) matchCache.delete(matchCache.keys().next().value);
  matchCache.set(key, match);
  return match;
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
const CORS = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': 'ngrok-skip-browser-warning',
  'access-control-expose-headers': 'x-collection-title, x-radio-source',
};

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
    // For uptime pingers (keeps the free host awake) and the host's health check: 503 if rooms are down.
    if (url.pathname === '/health') {
      const ok = await new Promise(done => {
        const s = net.connect(+WS_PORT, WS_HOST, () => { s.destroy(); done(true); });
        s.setTimeout(2000, () => { s.destroy(); done(false); });
        s.on('error', () => done(false));
      });
      return json(res, ok ? 200 : 503, { ok });
    }
    if (url.pathname === '/api/radio') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]{11}$/.test(id)) return json(res, 400, { error: 'Bad video id' });
      const { source, tracks } = await radio(id, (url.searchParams.get('artist') || '').slice(0, 200));
      res.setHeader('x-radio-source', source);
      return json(res, 200, tracks);
    }
    if (url.pathname === '/api/artist') {
      const id = url.searchParams.get('id') || '';
      if (!/^UC[\w-]{10,40}$/.test(id)) return json(res, 400, { error: 'Bad artist id' });
      return json(res, 200, await artistSongs(id));
    }
    if (url.pathname === '/api/collection') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]{2,80}$/.test(id)) return json(res, 400, { error: 'Bad playlist id' });
      const { title, tracks } = await collection(id);
      res.setHeader('x-collection-title', encodeURIComponent(title));
      return json(res, 200, tracks);
    }
    if (url.pathname === '/api/spotify') {
      const type = url.searchParams.get('type'), id = url.searchParams.get('id') || '';
      if (!['playlist', 'album'].includes(type) || !/^[A-Za-z0-9]{22}$/.test(id)) return json(res, 400, { error: 'Bad Spotify link' });
      return json(res, 200, await spotifyList(type, id));
    }
    if (url.pathname === '/api/match') {
      const title = (url.searchParams.get('title') || '').slice(0, 200), artist = (url.searchParams.get('artist') || '').slice(0, 200);
      if (!title) return json(res, 400, { error: 'Title required' });
      return json(res, 200, await matchSong(title, artist, Number(url.searchParams.get('duration')) || 0));
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
