/* src/lib/menu.ts
 * マイページのメニュー構成。サイドメニュー（Layout）とパンくずリスト（MyPage）で共通に使う。
 */

/** サブメニューに入れる項目（サイドメニューの下の段。スマホ下部のナビには出さず、≡ から開くメニューで選ぶ） */
export const SUB_MENU_IDS = ['test-prep', 'tips', 'feedback', 'setting'];

/** パンくずリストの先頭に出すグループ名 */
export const menuGroupLabel = (id: string) => (SUB_MENU_IDS.includes(id) ? 'サブメニュー' : 'メニュー');
