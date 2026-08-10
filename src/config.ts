/**
 * アプリ全体の設定をまとめるオブジェクト。
 * メニューや単価はここを編集すれば後から増減できる。
 *
 * ※パスワードなどの認証情報は「設計として」受け取らない。
 *   このフォームは連絡先・希望内容のみを受け付ける受付フォーム。
 */
const CONFIG = {
  /**
   * 希望メニュー → 単価（数量1あたりの金額）。
   * 単価が決まっていない場合は 0 のままでOK（金額は手入力で上書きできる）。
   */
  MENUS: {
    "コイン代行": 0,
    "スコア代行": 0,
    "その他": 0,
  } as { [name: string]: number },

  /** 記録先シート名 */
  SHEET_NAME: "受付",

  /** 受付シートのヘッダー（列の並び） */
  HEADER: [
    "受付日時",
    "受付番号",
    "希望メニュー",
    "数量",
    "金額",
    "連絡先",
    "備考",
    "支払い写真",
    "ステータス",
  ] as string[],

  /** 支払い写真の保存先（Googleドライブのフォルダ名。無ければ自動作成） */
  PHOTO_FOLDER_NAME: "受付_支払い写真",

  /** 支払い写真を必須にするか（true=必須 / false=任意） */
  REQUIRE_PHOTO: false,

  /** 受付番号の接頭辞（例: T-20260810-001） */
  RECEIPT_PREFIX: "T",

  /** 新規受付の初期ステータス */
  DEFAULT_STATUS: "未対応",

  /** タイムゾーン */
  TIMEZONE: "Asia/Tokyo",

  /** 画面タイトル */
  APP_TITLE: "受付フォーム",
};

/** メニュー名の一覧を返す。 */
function getMenuNames(): string[] {
  return Object.keys(CONFIG.MENUS);
}

/** メニューの単価を返す。未定義なら 0。 */
function getMenuPrice(name: string): number {
  const p = CONFIG.MENUS[name];
  return typeof p === "number" ? p : 0;
}
