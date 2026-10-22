# 幸とソロQ

ソロキュー（ひとりでのランクマッチ）が、ちょっとさみしくないように。2人の幸（ひなた・みお）がとなりで反応してくれる、スマホ向けのおともアプリです。

- 使う：https://nusag1.github.io/soloq/
- スマホのホーム画面に追加すると、アプリのように使えます（PCの2枚目のモニターでも使えます）
- データはこの端末のブラウザ（localStorage）の中だけ。Riot ID も含めて、どこにも送りません。設定から JSON で書き出し・読み込みができます
- 音声：VOICEVOX:春日部つむぎ（ひなた）、VOICEVOX:冥鳴ひまり（みお）
- Riot Games とは関係のない、個人のファンメイドのツールです

## できること
- **戦績**：試合が終わったら 結果（勝ち／負け／引き分け）・RR・エージェント・マップ（・キル/デス/アシスト）を10秒で記録。RR は結果ごとに前回の値が入る。期間ごとの勝率・RR・マップ別・エージェント別。tracker.gg のプロフィールを開くボタン（設定で Riot ID を入れたとき）
- **今日のセッション**：何試合まで（上限）と RR の目標を決めて始める。セッションの RR の線、日ごとの RR の線。上限に届いたら「ここまでにしませんか」。終えると講評（結果・目標・テーマ・良かったマップ・連敗などから文を組み立てる）
- **1試合1テーマ**：試合の前にテーマをひとつ選び、試合のあとに ○△× を付ける。テーマごとの達成率
- **幸の反応**：記録するたびに、勝ち・負け・連勝・連敗・テーマ・RR の目標・上限などに合わせて、文字と声で反応（ラジオ再生中は文字だけ）
- **ラジオ**：キュー待ち・エージェント選択・試合のあいだに聞く、1本1分くらいのおしゃべり10本（ラウンド中は止める前提）

## しくみメモ（開発用）
- `index.html`（見た目）＋ `app.js`（中身）＋ `fetcher.js`（自動取り込みの差し込み口）＋ `sw.js`・`manifest.webmanifest`（PWA。`tools/add_pwa.py` で作ったあと、`SHELL` に app.js などを足した）
- 保存は localStorage の `soloq.v1`：`matches[]`（`{id, ts, result, rr, agent, map, k, d, a, theme, mark, session, src, extId}`）、`sessions[]`（`{id, start, end, cap, goal, review}`）、`settings` など
- 1日の区切りは朝5時（設定で変えられる）
- **自動取り込み**：`fetcher.js` の `SoloQSource.fetchMatches({name, tag, since})` が試合の配列を返せばよい（形はファイルの先頭に書いてある）。`app.js` の `importMatches()` が `extId` で重複をはじいてセッションに振り分ける。いまは何も呼ばない（`enabled: false`）
- **声**：せりふは `voice/lines.json`（ラジオ `radio[]` と反応 `reactions.<種類>[]`）。PC3 で `python -X utf8 tools/make_voice.py` を実行すると、変わったものだけ `audio/<id>.mp3`（モノラル 24kHz 32kbps）と `audio/index.json`（秒数）を作り直す。VOICEVOX ENGINE は中で起こして止める
- 読み上げ用に英字はカタカナで書く（RR→アールアール）。個人の情報・政治的な話は入れない
- テスト用：`window.__soloq`（状態と主な関数）
- `sw.js` を変えたら `VERSION` を上げる
