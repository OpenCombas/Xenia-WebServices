import { canonicalPair, otherOf } from './friends.service';

describe('friends pure logic', () => {
  it('orders the pair canonically regardless of arg order', () => {
    expect(canonicalPair('A', 'B')).toEqual({ xuidLow: 'A', xuidHigh: 'B' });
    expect(canonicalPair('B', 'A')).toEqual({ xuidLow: 'A', xuidHigh: 'B' });
  });

  it('returns the other party of a pair', () => {
    const pair = canonicalPair('AAAA', 'BBBB');
    expect(otherOf(pair, 'AAAA')).toBe('BBBB');
    expect(otherOf(pair, 'BBBB')).toBe('AAAA');
  });
});
