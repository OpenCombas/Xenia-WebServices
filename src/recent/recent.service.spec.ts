import { pairsForJoin } from './recent.service';

// Synthetic xuids (no real gamertags/log data — open-source project).
const A = '0009000000000A01';
const B = '0009000000000B01';
const C = '0009000000000C01';

// unordered-pair key for asserting coverage regardless of direction order
const uset = (edges: [string, string][]) =>
  new Set(edges.map(([o, x]) => (o < x ? `${o}|${x}` : `${x}|${o}`)));

describe('pairsForJoin', () => {
  it('captures a single joiner against the one existing member, both directions', () => {
    // B joins a session that already holds A.
    const edges = pairsForJoin([A, B], [B]);
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual([B, A]);
    expect(edges).toContainEqual([A, B]);
  });

  it('captures a joiner against every existing member, not existing<->existing', () => {
    // C joins a session already holding A and B. A<->B was captured when B joined, so it must NOT reappear.
    const edges = pairsForJoin([A, B, C], [C]);
    expect(uset(edges)).toEqual(new Set([`${A}|${C}`, `${B}|${C}`]));
    // every emitted pair is symmetric
    expect(edges).toContainEqual([C, A]);
    expect(edges).toContainEqual([A, C]);
    expect(edges).toContainEqual([C, B]);
    expect(edges).toContainEqual([B, C]);
  });

  it('does not double-count a joiner<->joiner pair', () => {
    // A and B join together into an empty session: exactly one unordered pair, two directed edges.
    const edges = pairsForJoin([A, B], [A, B]);
    expect(edges).toHaveLength(2);
    expect(uset(edges)).toEqual(new Set([`${A}|${B}`]));
  });

  it('returns nothing for a solo session or no joiners', () => {
    expect(pairsForJoin([A], [A])).toEqual([]);
    expect(pairsForJoin([A, B], [])).toEqual([]);
  });

  it('ignores empty xuids and joiners not actually in the session', () => {
    expect(pairsForJoin([A, B, ''], [B])).toEqual([
      [B, A],
      [A, B],
    ]);
    expect(pairsForJoin([A, B], [C])).toEqual([]); // C not present -> nothing
  });
});
