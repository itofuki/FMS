/* src/lib/menu.ts
 * マイページのメニュー構成（サイドメニュー・下のタブで使う）。
 */

/** サブメニューに入れる項目（サイドメニューの下の段。スマホ下部のナビには出さず、≡ から開くメニューで選ぶ） */
export const SUB_MENU_IDS = ['test-prep', 'tips', 'feedback', 'setting'];

/*
 * 設定の中の特定の項目を開く（左下・ナビの上の自分のアイコンから「アカウント」へ）。
 * 設定の画面はタブを移ってから描かれるので、行き先を覚えておき、設定の画面が描かれたあとにそこまでスクロールする。
 */
export const SETTINGS_ACCOUNT_SECTION = 'settings-account';
const SETTINGS_SECTION_EVENT = 'fms:settings-section';
let pendingSettingsSection: string | null = null;

/** 設定のどの項目へ移るかを予約する（設定の画面がすでに開いていれば、すぐに移る） */
export function requestSettingsSection(id: string) {
  pendingSettingsSection = id;
  window.dispatchEvent(new Event(SETTINGS_SECTION_EVENT));
}

/** 予約された項目を受け取る（設定の画面から呼ぶ）。予約は 1 回使ったら消す */
export function takeSettingsSection(): string | null {
  const id = pendingSettingsSection;
  pendingSettingsSection = null;
  return id;
}

/** 予約されたときに呼ばれる関数を登録する（設定の画面から呼ぶ）。戻り値で登録を外す */
export function onSettingsSectionRequest(cb: () => void): () => void {
  window.addEventListener(SETTINGS_SECTION_EVENT, cb);
  return () => window.removeEventListener(SETTINGS_SECTION_EVENT, cb);
}
