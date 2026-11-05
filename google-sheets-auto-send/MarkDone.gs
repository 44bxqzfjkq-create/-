/**
 * I列のチェックを入れたら、そのセルを自動で「完了」にする（最小構成）
 * ------------------------------------------------------------------
 * ・Discord等への送信はなし。ステータス表示だけのシンプル版。
 * ・認証も初期設定の実行も不要。貼って保存するだけで動く（簡易 onEdit トリガー）。
 *
 * 使い方：
 *   1. I列のデータ範囲を選択 →「挿入 > チェックボックス」でチェックボックスを付ける
 *   2. Apps Script にこのコードを貼って保存する
 *   3. I列のチェックを入れると、そのセルが「完了」に変わる
 *
 * 注意：プロジェクト内に onEdit 関数は1つだけ。既に別の onEdit がある場合は
 *       中身を統合すること（2つあると片方しか動かない）。
 */
function onEdit(e) {
  const COL_I = 9;         // I列（A=1, B=2, ... I=9）
  const HEADER_ROW = 1;    // 見出しの行（1行目）

  if (!e || !e.range) return;
  const range = e.range;

  // I列以外／見出し行の編集は無視
  if (range.getColumn() !== COL_I) return;
  if (range.getRow() <= HEADER_ROW) return;

  // チェックが「入った」ときだけ「完了」にする
  if (String(e.value) === 'TRUE') {
    range.setValue('完了');
  }
}
