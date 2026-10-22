/* 幸とソロQ：戦績の「自動取り込み」の差し込み口
 *
 * いまは手入力だけ。ここでは外部の API を一切呼ばない（Riot ID も端末の外に出さない）。
 * 自動で取り込むようにするときは、このファイルの fetchMatches だけを書きかえ、enabled を true にする。
 *
 *   SoloQSource.fetchMatches(ctx) → Promise<Match[]>
 *     ctx   = { name: 'Riot ID の名前', tag: 'タグ', since: 前回取り込んだ最後の試合の時刻(ms) か 0 }
 *     Match = {
 *       extId:  'その試合の一意な ID（重複をはじくのに使う）',
 *       ts:     試合の開始時刻（ms）,
 *       result: 'win' | 'loss' | 'draw',
 *       rr:     RR の増減（数値。わからなければ null）,
 *       agent:  'エージェント名（カタカナ）', map: 'マップ名（カタカナ）',
 *       k, d, a: 数値 か null
 *     }
 *
 * 返した試合は app.js の importMatches() が受け取り、extId で重複をはじいて、
 * 時刻が重なるセッションに振り分けて保存する（テーマの ○△× はあとから手で付けられる）。
 */
window.SoloQSource = {
  id: 'manual',
  label: '手入力のみ',
  enabled: false,
  async fetchMatches(ctx) {
    return [];
  },
};
