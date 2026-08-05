# Astro Starter Kit: Minimal

```sh
pnpm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`             | Installs dependencies                            |
| `pnpm dev`             | Starts local dev server at `localhost:4321`      |
| `pnpm build`           | Build your production site to `./dist/`          |
| `pnpm preview`         | Preview your build locally, before deploying     |
| `pnpm astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help` | Get help using the Astro CLI                     |

## 🎧 Spotify 認証

Spotify の refresh token は**ユーザーが認可した時点から 6 ヶ月で失効**します（アクセストークンを更新しても期限は延びません）。新しい refresh token の取得にはブラウザでの同意が必須なので完全な自動化はできませんが、URL を 1 回開くだけで再認証が完結するようにしてあります。

### セットアップ

1. KV namespace を作成し、出力された ID を `wrangler.json` の `kv_namespaces[0].id` に設定する。

   ```sh
   pnpm wrangler kv namespace create SPOTIFY_TOKENS
   ```

2. Spotify Developer Dashboard の Redirect URI に `https://<your-domain>/spotify/callback` を登録する。

3. シークレットを設定する。

   | 名前 | 用途 |
   | :--- | :--- |
   | `SPOTIFY_CLIENT_ID` | Spotify アプリの Client ID |
   | `SPOTIFY_CLIENT_SECRET` | Spotify アプリの Client Secret |
   | `SPOTIFY_AUTH_SECRET` | `/spotify/login` を開くための合言葉（任意の長いランダム文字列） |
   | `SPOTIFY_USER_ID` | 保存を許可する Spotify ユーザー ID |
   | `SPOTIFY_REFRESH_TOKEN` | 任意。KV が空のときだけ使われる初期値 |

   ```sh
   pnpm wrangler secret put SPOTIFY_CLIENT_ID
   pnpm wrangler secret put SPOTIFY_CLIENT_SECRET
   pnpm wrangler secret put SPOTIFY_AUTH_SECRET
   pnpm wrangler secret put SPOTIFY_USER_ID
   ```

   `SPOTIFY_USER_ID` が分からない場合は未設定のまま次の手順に進むと、コールバック画面に自分の ID が表示されます（その回は保存されません）。表示された ID を設定してからやり直してください。

### 認証・再認証の手順

`https://<your-domain>/spotify/login?secret=<SPOTIFY_AUTH_SECRET>` をブラウザで開き、Spotify にログインして許可するだけです。取得した refresh token は KV に保存されるので、**再デプロイもシークレットの更新も不要**です。半年ごとにこれを実行してください。

### 失効したとき

- `/api/now-playing` が `503` と `{ "code": "reauthorization_required" }` を返します（トップページの表示は従来どおり「取得に失敗しました」のままで、閲覧者に再認証の事情は出しません）。
- 失効は KV に記録され、以降は Spotify を叩かずに即座にこのレスポンスを返します。上記の手順で再認証すればフラグは解除されます。
- サーバー側のログは `pnpm wrangler tail` で確認できます。`wrangler.json` の `observability` を有効にするとログが保持されます。

### 保護について

`/spotify/callback` は KV に refresh token を書き込むため、次の 2 段で保護しています。

- `/spotify/login` が発行した使い捨ての `state` を検証する
- 認可されたアカウントの ID が `SPOTIFY_USER_ID` と一致する場合のみ保存する

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
