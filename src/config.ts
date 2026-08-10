/**
 * アプリ全体の設定をまとめるオブジェクト。
 * 店舗を増やすときは STORES に「番号: 店舗名」を追加するだけでよい。
 * （店舗名がそのままスプレッドシートのシート名になる）
 */
const CONFIG = {
  /** LINEで送る番号 → 店舗名（＝記録先シート名）の対応表 */
  STORES: {
    "1": "A店",
    "2": "B店",
    "3": "C店",
  } as { [key: string]: string },

  /** 各店舗シートのヘッダー行 */
  HEADER: ["日時", "店舗名", "金額"] as string[],

  /** タイムゾーン（日時の整形・集計に使用） */
  TIMEZONE: "Asia/Tokyo",

  /** ダッシュボードのタイトル */
  DASHBOARD_TITLE: "売上ダッシュボード",
};

/** 番号から店舗名を引く。存在しなければ null。 */
function getStoreName(number: string): string | null {
  const name = CONFIG.STORES[number.trim()];
  return name ? name : null;
}

/** 全店舗名の配列を返す。 */
function getAllStoreNames(): string[] {
  return Object.keys(CONFIG.STORES).map((k) => CONFIG.STORES[k]);
}
