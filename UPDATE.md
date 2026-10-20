# 学祭精算 v4.0.1 ローカル修正パッチ

修正対象: PCサイドバー独立スクロール、匿名ユーザーのGoogleアカウント連携時の認証状態の判定、OAuthエラー案内、キャッシュ更新。

## 適用
- 現在のv4.0のフォルダをバックアップ。
- ZIPの `app.mjs`、`auth-helpers.mjs`、`cloud.css`、`sw.js` を **v4.0フォルダのルート**にコピーする。`config.js`は上書きしない。
- `http://localhost:8000/` から起動し、Ctrl+Shift+Rで再読み込み。
- Supabase > Authentication > Sign In / Providers > User Signups > Allow manual linking をONで保存。
- Google連携は元の匿名セッションのまま実行する。ログアウトせず、Google認証完了後にプロフィールを確認。
- Supabase > Authentication > URL Configuration > Redirect URLs にアプリの正しいURLを登録。
- Google OAuthのCallback URLはSupabase > Google設定からコピーし、Google Cloudの承認済みリダイレクトURIに登録。

注意: このパッチだけではGoogle OAuthプロバイダー設定の不一致やGoogleアカウントと別ユーザーの既存紐付けは解決しません。Supabaseの実OAuth接続テストは未実施です。
本番デプロイやSQL実行は不要です。
