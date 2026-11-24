import { describe, it, expect } from 'vitest';
import { htmlToText } from './lmsCourseContent';

describe('htmlToText（LMS の説明文を文字だけにする）', () => {
  it('タグを外し、段落と改行は改行にする', () => {
    expect(htmlToText('<p>一行目</p><p>二行目<br>三行目</p>')).toBe('一行目\n二行目\n三行目');
  });
  it('スクリプト・スタイルの中身は出さない', () => {
    expect(htmlToText('<p>本文</p><script>alert(1)</script><style>p{}</style>')).toBe('本文');
  });
  it('空なら空', () => {
    expect(htmlToText(null)).toBe('');
  });
});

describe('htmlToText（文字参照）', () => {
  it('&amp; や数値の文字参照を戻す', () => {
    expect(htmlToText('A&amp;B&nbsp;&#12354;&#x3044;')).toBe('A&B あい');
  });
});
