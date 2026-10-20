# 学祭精算 v4.1 — 一式・ローカル検証版

既存 v4.0 に対する追加要望を統合した **完全版ZIP** です。`index.html`、CSS、JavaScript、アイコン、既存SQL、追加SQL、テストを同梱しています。差分ファイルのみの配布ではありません。

> **重要：** GitHub Pages・本番Supabaseは自動的には変更されません。いま運用中のデータを消さずに更新します。新しいSQLを実行する場合は、**対象が開発用Supabaseであることを確認し、データをバックアップ**してください。

## 今回の修正内容

| 機能 | 内容 |
| --- | --- |
| スマホナビゲーション | 画面下は「ホーム・レジ・現金点検・在庫・メニュー」の5項目。ほかの機能は右から開くドロワーに格納。画面外タップ・×・Escで閉じる |
| PCナビゲーション | 既存の独立スクロールするサイドバーを維持 |
| Google連携 | 認証状態を「Google連携済み／未連携」と表示し、Googleメールアドレスを表示。連携後のユーザー再取得・OAuthエラー表示・匿名ID保護を維持 |
| 商品・原材料 | 完成品在庫の管理をやめ、商品名・価格・材料レシピのみ設定。販売時にレシピに応じて原材料の残数を減算 |
| 在庫不足 | 在庫0／マイナスの場合も警告表示だけで販売可能。数量調整や仕入れで後から修正できる |
| レジ開設 | 初回は「レジ名＋釣銭準備金」の1回の操作で登録と営業開始を同時実行。登録済みレジは「営業を開始する」から新しい営業セッションを開始 |
| 安定化 | 会計後のカート画面更新と、現金点検の中止処理を修正。過去のSQLトリガー修正も新規構築用SQLに統合 |

v4の既存機能（POS、売上・現金照合、仕入れ、材料在庫、貢献ポイント、立替精算、管理者承認、Googleログイン、参加者ID、最終分配）は維持します。

## 既にv4.0が動いている環境での更新（推奨）

1. **Supabaseの開発用プロジェクト**でバックアップを取得します。現時点の精算・商品・参加者を削除しないための更新ですが、DB変更前のバックアップを推奨します。
2. Supabase → SQL Editor → **`supabase/upgrade_v4_to_v4_1.sql`** の全文を実行してください。1回のトランザクションで、原材料在庫の下限制約、既存POS関数、初回レジ登録・営業開始RPCを更新します。
3. `Success. No rows returned` を確認します。既に同じSQLが適用されている場合は、原則再実行不要です。
4. 以前のローカル v4.0 フォルダの **`config.js`** に保存した「開発用Supabase Project URL」「Publishable Key」を、新しいフォルダの `config.js` に引き継ぎます。**Secret Key、`service_role`、DBパスワード、Google OAuth Client Secretは絶対に記載しないでください。**
5. 新しいv4.1フォルダでローカルサーバーを起動します。

   ```powershell
   cd "C:\path\to\gakusai-v4-complete"
   python -m http.server 8000 --bind 127.0.0.1
   ```

6. `http://localhost:8000/` を開いて、`Ctrl + Shift + R` で再読込します。以前のService Workerのキャッシュが残る場合はブラウザのDevTools → Application → Service Workersで更新を確認してください。**Google未連携の匿名アカウントでは、サイトデータやログインセッションを削除しないでください。**

### 新規DBをゼロから構築する場合だけ

v3のセットアップが完了した新しい開発用DBに対しては、`supabase/upgrade_v3_to_v4.sql` が **v4.1の修正を統合したSQL** です。この場合、`upgrade_v4_to_v4_1.sql` を続けて実行する必要はありません。

v2/v3の構築手順はそれぞれのファイルを参照。すでにv4が入っているDBに `setup.sql` や `upgrade_v3_to_v4.sql` を繰り返して実行しないでください。

## Google連携について

**ソースコードの更新だけではSupabase側の「Allow manual linking」が自動的にONになりません。** 画面に「Google未連携」と表示される場合は以下を確認してください。

1. Supabase → **Authentication → Sign In / Providers → User Signups → Allow manual linking** をONにして保存。
2. Authentication → Providers → Google が有効で、Google OAuth Client ID / Client SecretがSupabaseの設定画面にのみ保存されていることを確認。
3. Authentication → URL Configuration に、現在開いているURL（ローカルなら `http://localhost:8000/`）を許可。
4. **匿名アカウントはログアウトせず**、学祭精算アプリ → 参加者・設定 →「Googleに連携」を押してください。
5. Google認証後、同画面のステータスが「Google連携済み（複数端末OK）」か、実際のGoogleメールアドレスになったか確認してください。

既に別ユーザーに結び付いているGoogleアカウントは勝手に統合しません。元のアカウントのデータを失わないため、別途移行方法の確認が必要です。Google OAuth実認証は今回の静的/モックテストの対象外です。

## レジ登録・販売の確認順

1. 管理者でログインして「商品管理」で商品（例：サイダー）を登録。
2. 「在庫」で材料を登録し、商品の「材料レシピ」を設定。完成品の在庫設定は不要。
3. 「レジ」→初回は **「レジを登録して営業開始」** を押し、レジ名・釣銭準備金を入力。
4. レジを開いた直後にPOSの商品ボタンが有効になっているか確認。
5. 会計を確定。販売と同時に材料在庫が減算されること、売上記録に残ることを確認。
6. 材料在庫を0／マイナスにしても会計できることを確認。負数と警告は残す。
7. 「現金点検」で中間点検 → 中止／完了 → レジ締め → 売上照合を確認。
8. スマホ幅でボトムの5項目とハンバーガーメニューを確認。
9. Google連携後、別端末のGoogleログインで同一参加者のデータが表示されるか確認。

**本番公開**は、以上を開発用Supabaseで試してからにしてください。Google連携とDB関数の実環境動作、複数端末の同期は未検証です。

## 既存のトリガーエラーについて

以前の `record "old" has no field "event_id"` が既に解決していれば追加作業は不要です。エラーが残るDBでは `supabase/fix_v4_trigger_old_record.sql` を確認し、**バックアップ後に必要な場合だけ**実行してください。`supabase/upgrade_v3_to_v4.sql` には修正済みトリガーを含めています。

## ローカルのテスト

```powershell
node --test tests/*.test.mjs
```

テストは33件PASS（JSロジック、表示文字列、SQL契約、モックデータでのレジ／在庫／画面遷移）。**Supabase上での実SQL適用、Google OAuth実ログイン、PC・スマホ実機のブラウザ操作は別途検証が必要**です。

## ファイル

- `index.html`：Webアプリのエントリポイント
- `app.mjs`、`auth-helpers.mjs`：画面、参加者・Google認証
- `v4.mjs`、`v4-finance.mjs`：POS／材料在庫／レジ締め／売上照合
- `styles.css`、`cloud.css`、`v4.css`、`v4.1.css`：画面スタイル
- `config.js`：Supabase Project URL・Publishable Key（配布時は仮の値）
- `supabase/upgrade_v4_to_v4_1.sql`：既存v4 DBへの追加修正（今回実行するSQL）
- `supabase/upgrade_v3_to_v4.sql`：v3 DBから新規v4.1構築する場合の統合SQL
- `supabase/fix_v4_trigger_old_record.sql`：以前のトリガーエラー対応（適用済みなら不要）
- `tests/`：自動テスト

Private GitHubへのアップロードは可能ですが、`config.js` に公開用のProject URL・Publishable Key以外の秘密を記載しないでください。GitHub Pagesを利用する場合、Private化によって公開停止になるプラン制限に注意してください。
