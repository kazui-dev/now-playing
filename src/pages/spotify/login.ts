import type { APIRoute } from 'astro';
import {
  AUTHORIZE_ENDPOINT,
  REQUIRED_SCOPES,
  SpotifyConfigError,
  buildRedirectUri,
  createAuthState,
  getClientCredentials,
  isAuthorizedOperator,
} from '@/lib/spotify-auth';

const textResponse = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export const GET: APIRoute = async ({ request }) => {
  const requestUrl = new URL(request.url);

  let clientId: string;
  let authorized: boolean;
  try {
    ({ clientId } = getClientCredentials());
    authorized = isAuthorizedOperator(requestUrl.searchParams.get('secret'));
  } catch (error) {
    const message = error instanceof SpotifyConfigError ? error.message : '設定エラー';
    return textResponse(message, 500);
  }

  if (!authorized) {
    return textResponse('認可されていません。', 401);
  }

  const authorizeUrl = new URL(AUTHORIZE_ENDPOINT);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', buildRedirectUri(requestUrl));
  authorizeUrl.searchParams.set('scope', REQUIRED_SCOPES);
  authorizeUrl.searchParams.set('state', await createAuthState());
  authorizeUrl.searchParams.set('show_dialog', 'true');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl.toString(),
      'cache-control': 'no-store',
    },
  });
};
