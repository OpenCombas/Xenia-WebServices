import Leaderboard from '../aggregates/Leaderboard';
import LeaderboardId from '../value-objects/LeaderboardId';
import TitleId from '../value-objects/TitleId';
import Xuid from '../value-objects/Xuid';

// Outcome of claiming the right to apply one arbitrated report.
//   'applied'            - first report for this (session, view, player); the caller should apply it
//   'duplicate-agree'    - another console already reported the same values; consensus, do NOT apply again
//   'duplicate-mismatch' - another console reported DIFFERENT values; do NOT apply, and treat as a tamper
//                          signal rather than noise
export type ArbitrationClaim =
  | 'applied'
  | 'duplicate-agree'
  | 'duplicate-mismatch';

export default interface ILeaderboardRepository {
  findLeaderboard: (
    titleId: TitleId,
    id: LeaderboardId,
    player: Xuid,
  ) => Promise<Leaderboard | undefined>;
  save: (leaderboard: Leaderboard) => Promise<void>;
  // Atomically claim the right to apply an arbitrated report exactly once per (session, view, player).
  // See ArbitrationReportSchema for why arbitrated views arrive redundantly by design.
  claimArbitratedReport: (
    sessionId: string,
    titleId: TitleId,
    id: LeaderboardId,
    player: Xuid,
    stats: Record<string, { value: number }>,
  ) => Promise<ArbitrationClaim>;
}

export const ILeaderboardRepositorySymbol = Symbol('ILeaderboardRepository');
