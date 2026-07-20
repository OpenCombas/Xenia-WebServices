import { Inject } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import Leaderboard from 'src/domain/aggregates/Leaderboard';
import ILeaderboardRepository, {
  ILeaderboardRepositorySymbol,
} from 'src/domain/repositories/ILeaderboardRepository';
import { UpdateLeaderboardCommand } from '../commands/UpdateLeaderboardCommand';

@CommandHandler(UpdateLeaderboardCommand)
export class UpdateLeaderboardCommandHandler implements ICommandHandler<UpdateLeaderboardCommand> {
  constructor(
    @Inject(ILeaderboardRepositorySymbol)
    private repository: ILeaderboardRepository,
  ) {}

  async execute(command: UpdateLeaderboardCommand) {
    // An arbitrated view is reported by EVERY console in the session, for every player. The write path
    // applies `sum` unconditionally, so applying each report would multiply the delta by the player count
    // on exactly the columns arbitration exists to protect. Claim the row first; only the first reporter
    // applies, and any disagreement is logged inside the repository as a tamper signal.
    if (command.arbitrated && command.sessionId) {
      const claim = await this.repository.claimArbitratedReport(
        command.sessionId,
        command.titleId,
        command.leaderboardId,
        command.player,
        command.stats,
      );
      if (claim !== 'applied') return;
    }

    let leaderboard = await this.repository.findLeaderboard(
      command.titleId,
      command.leaderboardId,
      command.player,
    );

    if (!leaderboard) {
      leaderboard = new Leaderboard({
        id: command.leaderboardId,
        titleId: command.titleId,
        player: command.player,
        stats: command.stats,
      });
    } else {
      leaderboard.update({
        stats: command.stats,
      });
    }

    await this.repository.save(leaderboard);
  }
}
