import { Inject, Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import ISessionRepository, {
  ISessionRepositorySymbol,
} from 'src/domain/repositories/ISessionRepository';
import { JoinSessionCommand } from '../commands/JoinSessionCommand';
import { RecentService } from 'src/recent/recent.service';

@CommandHandler(JoinSessionCommand)
export class JoinSessionCommandHandler implements ICommandHandler<JoinSessionCommand> {
  private readonly logger = new Logger(JoinSessionCommandHandler.name);

  constructor(
    @Inject(ISessionRepositorySymbol)
    private repository: ISessionRepository,
    private readonly recent: RecentService,
  ) {}

  async execute(command: JoinSessionCommand) {
    const session = await this.repository.findSession(
      command.titleId,
      command.sessionId,
    );

    if (!session) {
      return undefined;
    }

    session.join({
      members: command.members,
    });

    await this.repository.save(session);

    // Record the co-membership this join formed (each joiner met every other current member) into the
    // recent-players feed. Best-effort and fire-and-forget: the join has already committed and must
    // return regardless, so a capture failure only logs.
    const allXuids = [...session.players.keys()];
    const joinerXuids = [...command.members.keys()].map((x) => x.value);
    void this.recent
      .captureJoin(allXuids, joinerXuids)
      .catch((e) => this.logger.warn(`recent capture failed: ${e}`));

    return session;
  }
}
