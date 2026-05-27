import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';
const TOKEN_BUFFER_MS = 30_000;

type SpotifyEnv = {
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
};

const runtimeEnv = env as unknown as SpotifyEnv;

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });

const getCredentials = () => {
  const clientId = runtimeEnv.SPOTIFY_CLIENT_ID;
  const clientSecret = runtimeEnv.SPOTIFY_CLIENT_SECRET;
  const refreshToken = runtimeEnv.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Spotify credentials are not configured.');
  }

  return { clientId, clientSecret, refreshToken };
};

const requestAccessToken = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && now < tokenExpiresAt - TOKEN_BUFFER_MS) {
    return cachedAccessToken;
  }

  const { clientId, clientSecret, refreshToken } = getCredentials();
  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Spotify token refresh failed: ${tokenResponse.status} ${errorBody}`);
  }

  const tokenData = await tokenResponse.json<{ access_token?: string; expires_in?: number }>();

  if (!tokenData.access_token || !tokenData.expires_in) {
    throw new Error('Spotify token response is missing required fields.');
  }

  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + tokenData.expires_in * 1000;

  return cachedAccessToken;
};

const fetchNowPlaying = async (accessToken: string) =>
  fetch(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Accept-Language': 'ja',
    },
  });

export const GET: APIRoute = async () => {
  let accessToken: string;
  try {
    accessToken = await requestAccessToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed.';
    return jsonResponse({ error: message }, 500);
  }

  let nowPlayingResponse = await fetchNowPlaying(accessToken);

  if (nowPlayingResponse.status === 401) {
    try {
      accessToken = await requestAccessToken(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token refresh failed.';
      return jsonResponse({ error: message }, 500);
    }
    nowPlayingResponse = await fetchNowPlaying(accessToken);
  }

  if (nowPlayingResponse.status === 204) {
    return jsonResponse({ isPlaying: false, serverTime: Date.now() });
  }

  if (!nowPlayingResponse.ok) {
    const errorBody = await nowPlayingResponse.text();
    return jsonResponse(
      {
        error: `Spotify API request failed: ${nowPlayingResponse.status} ${errorBody}`,
      },
      nowPlayingResponse.status,
    );
  }

  const playback = await nowPlayingResponse.json<{
    is_playing?: boolean;
    progress_ms?: number;
    item?: {
      name?: string;
      duration_ms?: number;
      external_urls?: { spotify?: string };
      album?: { name?: string; images?: Array<{ url?: string }> };
      artists?: Array<{ name?: string }>;
    };
  }>();

  if (!playback.item) {
    return jsonResponse({ isPlaying: false, serverTime: Date.now() });
  }

  const progressMs = typeof playback.progress_ms === 'number' ? playback.progress_ms : 0;
  const durationMs = playback.item.duration_ms ?? 0;
  const serverTime = Date.now();
  const startAt = serverTime - progressMs;
  const endAt = startAt + durationMs;

  return jsonResponse({
    isPlaying: playback.is_playing === true,
    track: {
      title: playback.item.name ?? '',
      album: playback.item.album?.name ?? '',
      artists: (playback.item.artists ?? [])
        .map((artist) => artist.name)
        .filter((name): name is string => Boolean(name)),
      imageUrl: playback.item.album?.images?.[0]?.url ?? '',
      spotifyUrl: playback.item.external_urls?.spotify ?? '',
      durationMs,
    },
    progressMs,
    startAt,
    endAt,
    serverTime,
  });
};
