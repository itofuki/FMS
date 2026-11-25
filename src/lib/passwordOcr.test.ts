import { describe, it, expect } from 'vitest';
import { pickCandidates } from './passwordOcr';

describe('pickCandidates（パスワードの候補）', () => {
  it('英数字 3〜16 文字だけを、確からしい順に', () => {
    expect(pickCandidates([
      { text: 'pass', confidence: 60 },
      { text: 'ab', confidence: 99 },
      { text: 'Xk72p', confidence: 70 },
      { text: 'abcdefghijklmnopq', confidence: 95 },
    ])).toEqual(['Xk72p', 'pass']);
  });
  it('記号を外し、同じ文字列は 1 つにまとめる', () => {
    expect(pickCandidates([{ text: 'A1b2-', confidence: 50 }, { text: 'A1b2', confidence: 80 }])).toEqual(['A1b2']);
  });
  it('英字と数字が混じったものを少し優先する', () => {
    expect(pickCandidates([{ text: 'hello', confidence: 75 }, { text: 'h3llo', confidence: 70 }])).toEqual(['h3llo', 'hello']);
  });
});
