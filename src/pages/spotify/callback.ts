import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

type SpotifyEnv = {
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
};

const runtimeEnv = env as unknown as SpotifyEnv;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const htmlResponse = (body: string, status = 200) =>
  new Response(
    `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spotify Callback</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; line-height: 1.6;">
    ${body}
  </body>
</html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

const getCredentials = () => {
  const clientId = runtimeEnv.SPOTIFY_CLIENT_ID;
  const clientSecret = runtimeEnv.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials are not configured.');
  }

  return { clientId, clientSecret };
};

export const GET: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);
  const error = requestUrl.searchParams.get('error');
  if (error) {
    return htmlResponse(
      `<h1>認証エラー</h1><p>${escapeHtml(error)}</p>`,
      400,
    );
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    return htmlResponse('<h1>code が見つかりませんでした。</h1>', 400);
  }

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getCredentials());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Credentials error';
    return htmlResponse(`<h1>設定エラー</h1><p>${escapeHtml(message)}</p>`, 500);
  }

  const redirectUri = `${requestUrl.origin}${requestUrl.pathname}`;
  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
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
    return htmlResponse(
      `<h1>トークン取得に失敗しました</h1><pre>${escapeHtml(errorBody)}</pre>`,
      tokenResponse.status,
    );
  }

  const tokenData = await tokenResponse.json<{
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
  }>();

  if (!tokenData.refresh_token) {
    return htmlResponse(
      '<h1>refresh_token が取得できませんでした。</h1>',
      400,
    );
  }

  return htmlResponse(
    `<h1>refresh_token を取得しました</h1>
<pre style="padding: 12px; background: #f4f4f5; border-radius: 8px;">${escapeHtml(tokenData.refresh_token)}</pre>`,
  );
};
