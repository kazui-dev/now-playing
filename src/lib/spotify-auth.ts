import { env } from 'cloudflare:workers';

export const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
export const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
export const PROFILE_ENDPOINT = 'https://api.spotify.com/v1/me';
export const REQUIRED_SCOPES = 'user-read-currently-playing';

const REFRESH_TOKEN_KEY = 'spotify:refresh-token';
const STATE_KEY_PREFIX = 'spotify:oauth-state:';
const STATE_TTL_SECONDS = 600;
const ACCESS_TOKEN_BUFFER_MS = 30_000;

type SpotifyEnv = {
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  SPOTIFY_USER_ID?: string;
  SPOTIFY_AUTH_SECRET?: string;
  SPOTIFY_TOKENS?: KVNamespace;
};

type StoredToken = {
  refreshToken: string;
  obtainedAt: number;
  invalidatedAt?: number;
};

const runtimeEnv = env as unknown as SpotifyEnv;

/** 設定漏れ。運用者が直すまで復旧しない。 */
export class SpotifyConfigError extends Error {}

/** refresh token が失効している。ユーザーの再認可でしか復旧できない。 */
export class SpotifyReauthRequiredError extends Error {}

let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0;

export const getClientCredentials = () => {
  const clientId = runtimeEnv.SPOTIFY_CLIENT_ID;
  const clientSecret = runtimeEnv.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new SpotifyConfigError('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET が設定されていません。');
  }

  return { clientId, clientSecret };
};

const getTokenStore = () => {
  const store = runtimeEnv.SPOTIFY_TOKENS;

  if (!store) {
    throw new SpotifyConfigError('KV binding "SPOTIFY_TOKENS" が設定されていません。');
  }

  return store;
};

export const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

export const buildRedirectUri = (requestUrl: URL) => `${requestUrl.origin}/spotify/callback`;

export const getAllowedUserId = () => runtimeEnv.SPOTIFY_USER_ID ?? null;

const timingSafeEqual = (a: string, b: string) => {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index]! ^ bBytes[index]!;
  }

  return diff === 0;
};

/** 認可フローを開始できるのは運用者だけ。 */
export const isAuthorizedOperator = (provided: string | null) => {
  const secret = runtimeEnv.SPOTIFY_AUTH_SECRET;

  if (!secret) {
    throw new SpotifyConfigError('SPOTIFY_AUTH_SECRET が設定されていません。');
  }

  return provided !== null && timingSafeEqual(provided, secret);
};

export const createAuthState = async () => {
  const state = crypto.randomUUID().replaceAll('-', '');
  await getTokenStore().put(`${STATE_KEY_PREFIX}${state}`, '1', {
    expirationTtl: STATE_TTL_SECONDS,
  });

  return state;
};

/** state は使い捨て。存在すれば消費して true。 */
export const consumeAuthState = async (state: string | null) => {
  if (!state) {
    return false;
  }

  const store = getTokenStore();
  const key = `${STATE_KEY_PREFIX}${state}`;
  const found = await store.get(key);

  if (found === null) {
    return false;
  }

  await store.delete(key);
  return true;
};

/**
 * KV を正とし、未保存なら SPOTIFY_REFRESH_TOKEN を初期値として使う。
 * 失効済みのレコードもそのまま返す（呼び出し側で invalidatedAt を見る）。
 */
const readStoredToken = async (): Promise<StoredToken | null> => {
  const stored = await getTokenStore().get<StoredToken>(REFRESH_TOKEN_KEY, 'json');

  if (stored?.refreshToken) {
    return stored;
  }

  const seed = runtimeEnv.SPOTIFY_REFRESH_TOKEN;
  return seed ? { refreshToken: seed, obtainedAt: 0 } : null;
};

export const saveRefreshToken = async (refreshToken: string) => {
  const record: StoredToken = { refreshToken, obtainedAt: Date.now() };
  await getTokenStore().put(REFRESH_TOKEN_KEY, JSON.stringify(record));

  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
};

/** 死んだトークンで毎回 Spotify を叩かないように失効を記録する。 */
const markRefreshTokenInvalid = async (stored: StoredToken) => {
  const record: StoredToken = { ...stored, invalidatedAt: Date.now() };
  await getTokenStore().put(REFRESH_TOKEN_KEY, JSON.stringify(record));
};

const isInvalidGrant = (status: number, body: string) => {
  if (status !== 400) {
    return false;
  }

  try {
    return (JSON.parse(body) as { error?: string }).error === 'invalid_grant';
  } catch {
    return false;
  }
};

export const getAccessToken = async (forceRefresh = false): Promise<string> => {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && now < accessTokenExpiresAt - ACCESS_TOKEN_BUFFER_MS) {
    return cachedAccessToken;
  }

  const stored = await readStoredToken();

  if (!stored) {
    throw new SpotifyConfigError('refresh token が保存されていません。/spotify/login から認証してください。');
  }

  if (stored.invalidatedAt) {
    throw new SpotifyReauthRequiredError(
      'refresh token が失効しています。/spotify/login から再認証してください。',
    );
  }

  const { clientId, clientSecret } = getClientCredentials();
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();

    // Spotify の仕様上リトライしても復旧しないので、記録して打ち切る。
    if (isInvalidGrant(tokenResponse.status, detail)) {
      await markRefreshTokenInvalid(stored);
      throw new SpotifyReauthRequiredError(
        'refresh token が失効しています。/spotify/login から再認証してください。',
      );
    }

    throw new Error(`Spotify token refresh failed: ${tokenResponse.status} ${detail}`);
  }

  const tokenData = await tokenResponse.json<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  }>();

  if (!tokenData.access_token || !tokenData.expires_in) {
    throw new Error('Spotify token response is missing required fields.');
  }

  // ローテーションされた場合は保存しないと次回以降 invalid_grant になる。
  if (tokenData.refresh_token && tokenData.refresh_token !== stored.refreshToken) {
    await saveRefreshToken(tokenData.refresh_token);
  }

  cachedAccessToken = tokenData.access_token;
  accessTokenExpiresAt = Date.now() + tokenData.expires_in * 1000;

  return cachedAccessToken;
};
