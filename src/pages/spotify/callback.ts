import type { APIRoute } from 'astro';
import {
  PROFILE_ENDPOINT,
  SpotifyConfigError,
  TOKEN_ENDPOINT,
  basicAuthHeader,
  buildRedirectUri,
  consumeAuthState,
  getAllowedUserId,
  getClientCredentials,
  saveRefreshToken,
} from '@/lib/spotify-auth';

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
    <meta name="robots" content="noindex" />
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

const codeBlock = (value: string) =>
  `<pre style="padding: 12px; background: #f4f4f5; border-radius: 8px;">${escapeHtml(value)}</pre>`;

export const GET: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);

  const authError = requestUrl.searchParams.get('error');
  if (authError) {
    return htmlResponse(`<h1>認証エラー</h1><p>${escapeHtml(authError)}</p>`, 400);
  }

  // state が無い/使用済みのリクエストは第三者による差し替えとみなす。
  let stateIsValid: boolean;
  try {
    stateIsValid = await consumeAuthState(requestUrl.searchParams.get('state'));
  } catch (error) {
    const message = error instanceof SpotifyConfigError ? error.message : '設定エラー';
    return htmlResponse(`<h1>設定エラー</h1><p>${escapeHtml(message)}</p>`, 500);
  }

  if (!stateIsValid) {
    return htmlResponse(
      '<h1>state が不正です</h1><p><code>/spotify/login</code> からやり直してください。</p>',
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
    ({ clientId, clientSecret } = getClientCredentials());
  } catch (error) {
    const message = error instanceof SpotifyConfigError ? error.message : '設定エラー';
    return htmlResponse(`<h1>設定エラー</h1><p>${escapeHtml(message)}</p>`, 500);
  }

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: buildRedirectUri(requestUrl),
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    return htmlResponse(
      `<h1>トークン取得に失敗しました</h1>${codeBlock(errorBody)}`,
      tokenResponse.status,
    );
  }

  const tokenData = await tokenResponse.json<{
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
  }>();

  if (!tokenData.refresh_token || !tokenData.access_token) {
    return htmlResponse('<h1>refresh_token が取得できませんでした。</h1>', 400);
  }

  const profileResponse = await fetch(PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileResponse.ok) {
    return htmlResponse('<h1>ユーザー情報の取得に失敗しました。</h1>', 502);
  }

  const profile = await profileResponse.json<{ id?: string; display_name?: string }>();
  const profileId = profile.id;

  if (!profileId) {
    return htmlResponse('<h1>ユーザー情報の取得に失敗しました。</h1>', 502);
  }

  // 許可ユーザー未設定のまま保存すると誰でも上書きできてしまう。
  const allowedUserId = getAllowedUserId();
  if (!allowedUserId) {
    return htmlResponse(
      `<h1>SPOTIFY_USER_ID が未設定です</h1>
<p>次の ID を <code>SPOTIFY_USER_ID</code> に設定してから、もう一度やり直してください。</p>
${codeBlock(profileId)}
<p>今回の refresh token は保存していません。</p>`,
      409,
    );
  }

  if (profileId !== allowedUserId) {
    return htmlResponse(
      `<h1>許可されていないアカウントです</h1>
<p>このサイトのオーナー以外のアカウントでは保存できません。</p>`,
      403,
    );
  }

  await saveRefreshToken(tokenData.refresh_token);

  const displayName = profile.display_name ?? profileId;

  return htmlResponse(
    `<h1>refresh token を保存しました</h1>
<p>アカウント: ${escapeHtml(displayName)}</p>
<p>再デプロイは不要です。そのまま <a href="/">トップページ</a> をご確認ください。</p>`,
  );
};
