import { describe, it, expect } from 'vitest';
import { parseCourseName, cleanTeacherName } from './lmsCourses';

describe('parseCourseName', () => {
  it('曜日と連続した時限を読み取る', () => {
    expect(parseCourseName('グローバル市場化戦略A（2026_火曜3・4限_IA3A/IA3B）')).toEqual({ name: 'グローバル市場化戦略A', wday: 'Tue', periods: [3, 4] });
    expect(parseCourseName('人工知能応用A（2026_金曜1・2・3・4限_IA3A/IA3B）')).toEqual({ name: '人工知能応用A', wday: 'Fri', periods: [1, 2, 3, 4] });
    expect(parseCourseName('英語コミュニケーションⅢbB（2026_火曜1・2限_3年）')).toEqual({ name: '英語コミュニケーションⅢbB', wday: 'Tue', periods: [1, 2] });
  });
  it('全角数字や 1 コマだけでも読める', () => {
    expect(parseCourseName('線形代数（2026_月曜２限）')).toEqual({ name: '線形代数', wday: 'Mon', periods: [2] });
  });
  it('曜日・時限がなければ null', () => {
    expect(parseCourseName('ソリューション開発ⅠB（2026_三宅）')).toEqual({ name: 'ソリューション開発ⅠB', wday: null, periods: null });
    expect(parseCourseName('3年生共通3（2026）')).toEqual({ name: '3年生共通3', wday: null, periods: null });
  });
});

describe('cleanTeacherName', () => {
  it('先頭のローマ字のログイン ID を外し、空白をそろえる', () => {
    expect(cleanTeacherName('machide.tomoya 町出　智也')).toBe('町出 智也');
    expect(cleanTeacherName('三宅 茂樹')).toBe('三宅 茂樹');
  });
  it('ローマ字だけの名前はそのまま', () => {
    expect(cleanTeacherName('Tabara Shizuka')).toBe('Tabara Shizuka');
  });
});
