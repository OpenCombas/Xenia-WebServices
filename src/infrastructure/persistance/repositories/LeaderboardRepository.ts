import { Model } from 'mongoose';
import { ConsoleLogger, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import ILeaderboardRepository, {
  ArbitrationClaim,
} from 'src/domain/repositories/ILeaderboardRepository';
import Leaderboard from 'src/domain/aggregates/Leaderboard';
import LeaderboardDomainMapper from '../mappers/LeaderboardDomainMapper';
import LeaderboardPersistanceMapper from '../mappers/LeaderboardPersistanceMapper';
import { LeaderboardDocument } from '../models/LeaderboardSchema';
import {
  ArbitrationReport,
  ArbitrationReportDocument,
} from '../models/ArbitrationReportSchema';
import TitleId from 'src/domain/value-objects/TitleId';
import LeaderboardId from 'src/domain/value-objects/LeaderboardId';
import Xuid from 'src/domain/value-objects/Xuid';

@Injectable()
export default class LeaderboardRepository implements ILeaderboardRepository {
  constructor(
    private readonly logger: ConsoleLogger,
    @InjectModel(Leaderboard.name)
    private LeaderboardModel: Model<LeaderboardDocument>,
    @InjectModel(ArbitrationReport.name)
    private ArbitrationReportModel: Model<ArbitrationReportDocument>,
    private readonly leaderboardDomainMapper: LeaderboardDomainMapper,
    private readonly leaderboardPersistanceMapper: LeaderboardPersistanceMapper,
  ) {
    this.logger.setContext(LeaderboardRepository.name);
  }

  public async save(leaderboard: Leaderboard) {
    await this.LeaderboardModel.findOneAndUpdate(
      {
        id: leaderboard.id.value,
        titleId: leaderboard.titleId.toString(),
        player: leaderboard.player.value,
      },
      this.leaderboardPersistanceMapper.mapToDataModel(leaderboard),
      {
        upsert: true,
        returnDocument: 'after',
      },
    );
  }

  // Claim the right to apply ONE arbitrated report for a (session, view, player).
  //
  // Correctness rests on the unique index doing the arbitration: several consoles report the same row at
  // nearly the same moment, so insert-wins is an atomic claim. A find-then-insert here would race and let
  // two reports both believe they were first -- which is precisely the double-count this exists to stop.
  public async claimArbitratedReport(
    sessionId: string,
    titleId: TitleId,
    id: LeaderboardId,
    player: Xuid,
    stats: Record<string, { value: number }>,
  ): Promise<ArbitrationClaim> {
    const key = {
      sessionId,
      titleId: titleId.toString(),
      leaderboardId: id.value,
      player: player.value,
    };
    const values: Record<string, number> = {};
    Object.entries(stats).forEach(([k, v]) => (values[k] = v.value));

    try {
      await this.ArbitrationReportModel.create({ ...key, stats: values });
      return 'applied';
    } catch (error) {
      // 11000 = duplicate key: someone already claimed this row. Anything else is a real failure and must
      // not be swallowed into a "duplicate" verdict, or a database outage would silently drop stats.
      if (error?.code !== 11000) throw error;
    }

    const existing = await this.ArbitrationReportModel.findOne(key);
    const previous = (existing?.stats ?? {}) as Record<string, number>;
    const agrees =
      Object.keys(values).length === Object.keys(previous).length &&
      Object.entries(values).every(([k, v]) => previous[k] === v);

    if (!agrees) {
      // A tamper signal on hardware, and on our side more likely a genuine bug -- either way it means two
      // consoles disagreed about what happened in a session, which is worth surfacing rather than dropping.
      this.logger.warn(
        `Arbitrated report MISMATCH session=${sessionId} view=${id.value} player=${player.value}: ` +
          `applied ${JSON.stringify(previous)}, later report ${JSON.stringify(values)}`,
      );
      return 'duplicate-mismatch';
    }
    return 'duplicate-agree';
  }

  public async findLeaderboard(
    titleId: TitleId,
    id: LeaderboardId,
    player: Xuid,
  ) {
    const leaderboard = await this.LeaderboardModel.findOne({
      id: id.value,
      titleId: titleId.toString(),
      player: player.value,
    });

    if (!leaderboard) {
      return undefined;
    }

    return this.leaderboardDomainMapper.mapToDomainModel(leaderboard);
  }
}
