import {
  isPartyFull,
  reapStaleMembers,
  shouldDissolve,
  MAX_PARTY_MEMBERS,
  MEMBER_REAP_MS,
} from './party.service';

describe('party pure logic', () => {
  it('caps membership at MAX_PARTY_MEMBERS', () => {
    expect(isPartyFull(MAX_PARTY_MEMBERS - 1)).toBe(false);
    expect(isPartyFull(MAX_PARTY_MEMBERS)).toBe(true);
    expect(isPartyFull(MAX_PARTY_MEMBERS + 1)).toBe(true);
  });

  it('reaps members idle past the threshold, keeps fresh ones', () => {
    const now = 1_000_000;
    const fresh = { xuid: 'A', lastPoll: new Date(now - 5_000) };
    const boundary = { xuid: 'B', lastPoll: new Date(now - MEMBER_REAP_MS) };
    const stale = { xuid: 'C', lastPoll: new Date(now - (MEMBER_REAP_MS + 1)) };
    const live = reapStaleMembers([fresh, boundary, stale], now);
    expect(live.map((m) => m.xuid)).toEqual(['A', 'B']); // stale C dropped, boundary kept
  });

  it('dissolves when empty or the owner is gone; survives while the owner remains', () => {
    expect(shouldDissolve([], 'OWNER')).toBe(true);
    expect(shouldDissolve([{ xuid: 'X' }], 'OWNER')).toBe(true); // owner reaped/left
    expect(shouldDissolve([{ xuid: 'OWNER' }, { xuid: 'X' }], 'OWNER')).toBe(
      false,
    );
  });
});
