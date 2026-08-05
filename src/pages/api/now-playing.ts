import type { APIRoute } from 'astro';
import {
  SpotifyConfigError,
  SpotifyReauthRequiredError,
  getAccessToken,
} from '@/lib/spotify-auth';

const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });

/**
 * トークン取得の失敗はレスポンスに詳細を載せず、原因の種類だけを返す。
 * 詳細は Workers のログ側に出す。
 */
const tokenErrorResponse = (error: unknown) => {
  if (error instanceof SpotifyReauthRequiredError) {
    console.error('[spotify] refresh token expired; re-authorize at /spotify/login');
    return jsonResponse(
      { error: 'Spotify の再認証が必要です。', code: 'reauthorization_required' },
      503,
    );
  }

  if (error instanceof SpotifyConfigError) {
    console.error('[spotify] configuration error:', error.message);
    return jsonResponse({ error: error.message, code: 'configuration_error' }, 500);
  }

  console.error('[spotify] token refresh failed:', error);
  return jsonResponse({ error: 'Spotify のトークン取得に失敗しました。', code: 'token_error' }, 500);
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
    accessToken = await getAccessToken();
  } catch (error) {
    return tokenErrorResponse(error);
  }

  let nowPlayingResponse = await fetchNowPlaying(accessToken);

  if (nowPlayingResponse.status === 401) {
    try {
      accessToken = await getAccessToken(true);
    } catch (error) {
      return tokenErrorResponse(error);
    }
    nowPlayingResponse = await fetchNowPlaying(accessToken);
  }

  if (nowPlayingResponse.status === 204) {
    return jsonResponse({ isPlaying: false, serverTime: Date.now() });
  }

  if (!nowPlayingResponse.ok) {
    const errorBody = await nowPlayingResponse.text();
    console.error(`[spotify] now-playing request failed: ${nowPlayingResponse.status} ${errorBody}`);
    return jsonResponse(
      { error: 'Spotify API の呼び出しに失敗しました。', code: 'upstream_error' },
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
