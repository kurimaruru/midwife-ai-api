# MidwifeAI API

iOS育児アプリ「MidwifeAI」のバックエンドAPIプロキシサーバー。
Cloudflare Workers + Hono で構築し、OpenAI API へのプロキシ・Apple JWS認証・レート制限を提供する。

## 技術スタック

| 項目 | 技術 |
|------|------|
| ランタイム | Cloudflare Workers |
| フレームワーク | Hono 4.12.7 |
| バリデーション | Zod |
| JWS検証 | jose (Web Crypto API互換) |
| ストレージ | Cloudflare KV (レート制限) |
| AI | OpenAI API (gpt-4o-mini / gpt-4o) |

## エンドポイント

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| GET | `/v1/health` | 不要 | ヘルスチェック |
| POST | `/v1/advice` | 必須 | 日次アドバイス生成 (gpt-4o-mini) |
| POST | `/v1/chat` | 必須 | AIチャット (gpt-4o) |

## ディレクトリ構成

```
src/
  index.ts                  # エントリポイント・ルーティング・CORS・エラーハンドラ
  types.ts                  # 型定義 (Env, リクエスト/レスポンス)
  middleware/
    auth.ts                 # Apple JWS (x5c証明書チェーン) 検証
    rate-limit.ts           # KVベースのレート制限
  services/
    openai.ts               # OpenAI API クライアント
    log-formatter.ts        # activityLogs → 日本語テキスト整形
    prompt-builder.ts       # システムプロンプト構築
  routes/
    health.ts               # GET /v1/health
    advice.ts               # POST /v1/advice
    chat.ts                 # POST /v1/chat
  utils/
    errors.ts               # エラーコード・AppErrorクラス
    validation.ts           # Zodスキーマ
```

---

## 開発環境セットアップ

### 前提条件

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Cloudflare アカウント** ([dash.cloudflare.com](https://dash.cloudflare.com))
- **Wrangler CLI** がログイン済みであること

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. Wrangler のログイン

まだログインしていない場合:

```bash
npx wrangler login
```

ブラウザが開き、Cloudflare アカウントで認証する。

### 3. KV Namespace の作成

開発用(preview)と本番用の KV Namespace を作成する:

```bash
# 本番用
npx wrangler kv namespace create RATE_LIMIT

# 開発用 (--preview)
npx wrangler kv namespace create RATE_LIMIT --preview
```

それぞれ出力される `id` を `wrangler.jsonc` に設定する:

```jsonc
"kv_namespaces": [
  {
    "binding": "RATE_LIMIT",
    "id": "<本番用の KV Namespace ID>",
    "preview_id": "<開発用の KV Namespace ID>"
  }
]
```

### 4. 環境変数(シークレット)の設定

#### 開発環境

プロジェクトルートに `.dev.vars` ファイルを作成する:

```bash
touch .dev.vars
```

`.dev.vars` の内容:

```ini
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> `.dev.vars` は `.gitignore` に含まれているため、リポジトリにコミットされない。

#### 本番環境

本番のシークレットは後述の[本番デプロイ手順](#本番環境へのデプロイ)で設定する。

### 5. ローカル開発サーバーの起動

```bash
npm run dev
```

以下のように表示されればOK:

```
⎔ Starting local server...
[wrangler:inf] Ready on http://localhost:8787
```

---

## ローカル動作確認

### ヘルスチェック

```bash
curl http://localhost:8787/v1/health
```

期待レスポンス:

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### 認証なしアクセスの確認 (401)

```bash
curl -X POST http://localhost:8787/v1/advice \
  -H "Content-Type: application/json" \
  -d '{}'
```

期待レスポンス:

```json
{
  "error": {
    "code": "AUTH_MISSING",
    "message": "認証情報が必要です。"
  }
}
```

### 不正トークンの確認 (401)

```bash
curl -X POST http://localhost:8787/v1/advice \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{}'
```

期待レスポンス:

```json
{
  "error": {
    "code": "AUTH_INVALID",
    "message": "認証情報が無効です。"
  }
}
```

### advice エンドポイント (認証バイパスでの手動テスト)

本番の Apple JWS トークンなしで advice / chat の機能をテストするには、
一時的に `src/routes/advice.ts` の `authMiddleware` をコメントアウトする:

```ts
advice.post(
  '/advice',
  // authMiddleware,                    // ← 一時的にコメントアウト
  // rateLimitMiddleware({ ... }),      // ← KV未設定ならこちらも
  async (c) => {
```

その後、以下のリクエストで動作確認:

```bash
curl -X POST http://localhost:8787/v1/advice \
  -H "Content-Type: application/json" \
  -d '{
    "baby": {
      "name": "太郎",
      "birthDate": "2026-01-15"
    },
    "date": "2026-03-15",
    "activityLogs": [
      {
        "type": "breastFeeding",
        "timestamp": "2026-03-15T06:30:00+09:00",
        "leftBreastMinutes": 10,
        "rightBreastMinutes": 8
      },
      {
        "type": "bottleFeeding",
        "timestamp": "2026-03-15T07:00:00+09:00",
        "amountML": 80
      },
      {
        "type": "temperature",
        "timestamp": "2026-03-15T08:00:00+09:00",
        "temperature": 36.8
      }
    ]
  }'
```

期待レスポンス (OpenAI APIキーが有効な場合):

```json
{
  "advice": "太郎ちゃんの...(AIが生成したアドバイス)",
  "generatedAt": "2026-03-15T..."
}
```

### chat エンドポイント

同様に `src/routes/chat.ts` のミドルウェアをコメントアウトして:

```bash
curl -X POST http://localhost:8787/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "baby": {
      "name": "太郎",
      "birthDate": "2026-01-15"
    },
    "messages": [
      {
        "role": "user",
        "content": "最近夜泣きがひどくて困っています。何か対処法はありますか？"
      }
    ],
    "activityLogs": [
      {
        "type": "sleep",
        "timestamp": "2026-03-14T21:00:00+09:00",
        "sleepEnd": "2026-03-15T01:30:00+09:00"
      },
      {
        "type": "cry",
        "timestamp": "2026-03-15T01:30:00+09:00",
        "note": "30分泣き続けた"
      }
    ]
  }'
```

期待レスポンス:

```json
{
  "message": {
    "role": "assistant",
    "content": "夜泣きは...(AIが生成した回答)"
  },
  "generatedAt": "2026-03-15T..."
}
```

### バリデーションエラーの確認 (400)

```bash
curl -X POST http://localhost:8787/v1/advice \
  -H "Content-Type: application/json" \
  -d '{
    "baby": { "name": "", "birthDate": "invalid" },
    "date": "2026-03-15",
    "activityLogs": []
  }'
```

期待レスポンス:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "..."
  }
}
```

> テストが終わったら、コメントアウトしたミドルウェアを必ず元に戻すこと。

---

## 本番環境へのデプロイ

### 1. KV Namespace ID の確認

`wrangler.jsonc` の `kv_namespaces[].id` に本番用の KV Namespace ID が設定されていることを確認する。

まだ作成していない場合:

```bash
npx wrangler kv namespace create RATE_LIMIT
```

出力例:

```
🌀 Creating namespace with title "midwifeai-api-RATE_LIMIT"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{
  binding = "RATE_LIMIT",
  id = "abcdef1234567890abcdef1234567890"
}
```

この `id` を `wrangler.jsonc` に反映する。

### 2. シークレットの登録

```bash
npx wrangler secret put OPENAI_API_KEY
```

プロンプトが表示されるので、OpenAI API キーを入力する。

> シークレットはデプロイ先の Worker に暗号化されて保存される。
> `wrangler.jsonc` や `.dev.vars` には含まれない。

### 3. デプロイ実行

```bash
npm run deploy
```

出力例:

```
Total Upload: 652.85 KiB / gzip: 109.00 KiB
Uploaded midwifeai-api
Published midwifeai-api
  https://midwifeai-api.kurikuribaseball530.workers.dev
```

### 4. デプロイ後の動作確認

```bash
# ヘルスチェック
curl https://midwifeai-api.kurikuribaseball530.workers.dev/v1/health

# 認証なしで 401 が返ることを確認
curl -X POST https://midwifeai-api.kurikuribaseball530.workers.dev/v1/advice \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 5. カスタムドメインの設定 (任意)

Cloudflare Dashboard で Workers のカスタムドメインを設定する:

1. **Cloudflare Dashboard** → **Workers & Pages** → **midwifeai-api**
2. **Settings** → **Triggers** → **Custom Domains**
3. `api.midwifeai.com` を追加
4. DNS レコードが自動で作成される

設定後:

```bash
curl https://api.midwifeai.com/v1/health
```

---

## 環境変数一覧

| 変数名 | 種別 | 説明 | 設定場所 |
|--------|------|------|----------|
| `OPENAI_API_KEY` | Secret | OpenAI APIキー | `.dev.vars` (開発) / `wrangler secret` (本番) |
| `ALLOWED_BUNDLE_ID` | Var | iOS アプリの Bundle ID | `wrangler.jsonc` |
| `PREMIUM_PRODUCT_ID` | Var | サブスクリプションの Product ID | `wrangler.jsonc` |
| `RATE_LIMIT` | KV Binding | レート制限カウンタ用 KV | `wrangler.jsonc` |

## レート制限

| エンドポイント | 日次上限 (JST基準) | バースト制限 |
|---------------|-------------------|-------------|
| POST /v1/advice | 30回/日 | 10回/分 |
| POST /v1/chat | 100回/日 | 10回/分 |

レスポンスヘッダーで残り回数を確認可能:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1741798800
```

---

## トラブルシューティング

### `wrangler dev` で KV 関連エラーが出る

KV の `preview_id` が未設定の場合に発生する。`wrangler.jsonc` に `preview_id` を追加する:

```bash
npx wrangler kv namespace create RATE_LIMIT --preview
```

### OpenAI API から 401 が返る

`.dev.vars` の `OPENAI_API_KEY` が正しいか確認する。
キーは `sk-` で始まる文字列。

### デプロイ後に 500 エラーが返る

シークレットが未設定の可能性がある:

```bash
npx wrangler secret list
```

`OPENAI_API_KEY` が一覧に含まれていることを確認する。

### ログの確認

リアルタイムログを確認する:

```bash
npx wrangler tail
```

特定のステータスコードでフィルタ:

```bash
npx wrangler tail --status error
```
