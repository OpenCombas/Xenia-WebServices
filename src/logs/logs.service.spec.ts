import { pruneAndCheck } from './logs.service';

describe('pruneAndCheck (log-upload rate limit)', () => {
  it('allows up to max within the window, then blocks', () => {
    const win = 60_000;
    let times: number[] = [];
    // 3 hits at t=0 with max=3 -> 1st,2nd allowed, 3rd blocked.
    const r1 = pruneAndCheck(times, 0, 3, win);
    expect(r1.allowed).toBe(true);
    times = r1.kept;
    const r2 = pruneAndCheck(times, 10, 3, win);
    expect(r2.allowed).toBe(true);
    times = r2.kept;
    const r3 = pruneAndCheck(times, 20, 3, win);
    expect(r3.allowed).toBe(true);
    times = r3.kept;
    const r4 = pruneAndCheck(times, 30, 3, win); // 4th within window -> blocked
    expect(r4.allowed).toBe(false);
    expect(r4.kept).toHaveLength(3);
  });

  it('lets hits back in once older ones age out of the window', () => {
    const win = 1000;
    const times = [0, 100, 200]; // 3 hits, max 3
    const blocked = pruneAndCheck(times, 300, 3, win);
    expect(blocked.allowed).toBe(false);
    // at t=1200 the first three are all >window old -> pruned, allowed again
    const allowed = pruneAndCheck(times, 1200, 3, win);
    expect(allowed.allowed).toBe(true);
    expect(allowed.kept).toEqual([1200]);
  });
});
