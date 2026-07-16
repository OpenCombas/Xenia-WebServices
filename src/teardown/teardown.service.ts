import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import Xuid from 'src/domain/value-objects/Xuid';
import MacAddress from 'src/domain/value-objects/MacAddress';
import IpAddress from 'src/domain/value-objects/IpAddress';
import SyntheticIp from 'src/domain/value-objects/SyntheticIp';
import SessionId from 'src/domain/value-objects/SessionId';
import TitleId from 'src/domain/value-objects/TitleId';
import StateFlag, { StateFlags } from 'src/domain/value-objects/StateFlag';
import Player from 'src/domain/aggregates/Player';
import { DeleteSessionsCommand } from 'src/application/commands/DeleteSessionCommand';
import { FindPlayerQuery } from 'src/application/queries/FindPlayerQuery';
import { UpdatePlayerCommand } from 'src/application/commands/UpdatePlayerCommand';
import IPlayerRepository, {
  IPlayerRepositorySymbol,
} from 'src/domain/repositories/IPlayerRepository';
import { PartyService } from 'src/party/party.service';

// Exit-time teardown of a console's transient state. Invoked by BOTH `POST /goodbye` (clean exit, immediate)
// and the WS-disconnect catch-all (crashes). It is IDEMPOTENT and each hook is BEST-EFFORT — a hook failure
// never blocks the others, and re-running (both triggers can fire for one exit) is a safe no-op. Durable
// data (friends, recent, credentials) is untouched. See plan-goodbye-teardown.
@Injectable()
export class TeardownService {
  private readonly logger = new Logger(TeardownService.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly party: PartyService,
    @Inject(IPlayerRepositorySymbol)
    private readonly players: IPlayerRepository,
  ) {}

  // teardown(xuid, mac?). mac is needed for the MAC-keyed session hook; if the caller doesn't supply it
  // (e.g. the WS trigger), it is resolved from the Player doc.
  async teardown(xuidRaw: string, macRaw?: string): Promise<void> {
    let xuid: Xuid;
    try {
      xuid = new Xuid(xuidRaw);
    } catch {
      return;
    }

    let mac: MacAddress | null = null;
    if (macRaw) {
      try {
        mac = new MacAddress(macRaw);
      } catch {
        mac = null;
      }
    }
    if (!mac) {
      const p = await this.players.findByXuid(xuid).catch(() => undefined);
      if (p?.macAddress) mac = p.macAddress;
    }

    // hook: sessions (+ reset the console's presence/sessionId). Sessions are MAC-keyed.
    if (mac) {
      await this.teardownSessions(mac).catch((e) =>
        this.logger.warn(`session teardown for ${xuid.value} failed: ${e}`),
      );
    }

    // hook: party — leave/dissolve. Also closes the deferred "no WS-disconnect party reap" gap.
    await this.party
      .leaveByXuid(xuid.value)
      .catch((e) =>
        this.logger.warn(`party teardown for ${xuid.value} failed: ${e}`),
      );
  }

  // Mirrors XNetController.deleteAllSessions: delete the console's sessions (by synthetic-IP-from-MAC) and
  // reset the owning player's session/title/state.
  private async teardownSessions(mac: MacAddress): Promise<void> {
    const ipv4 = SyntheticIp.fromMac(mac).value;
    const ip = new IpAddress(ipv4);

    await this.commandBus.execute(new DeleteSessionsCommand(ip, mac));

    const player: Player = await this.queryBus.execute(new FindPlayerQuery(ip));
    if (player) {
      player.setSession(new SessionId('0'.repeat(16)));
      player.setTitleId(new TitleId('0'));
      player.setState(
        new StateFlag(
          StateFlags.ONLINE | StateFlags.JOINABLE | StateFlags.PLAYING,
        ),
      );
      player.setRichPresence('');
      await this.commandBus.execute(
        new UpdatePlayerCommand(player.xuid, player),
      );
    }
  }
}
