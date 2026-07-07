import { ConsoleLogger, Controller, Get } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Delete, Param, Query } from '@nestjs/common/decorators';
import IpAddress from 'src/domain/value-objects/IpAddress';
import MacAddress from 'src/domain/value-objects/MacAddress';
import SyntheticIp from 'src/domain/value-objects/SyntheticIp';
import { DeleteSessionsCommand } from 'src/application/commands/DeleteSessionCommand';
import { RealIP } from 'nestjs-real-ip';
import { ProcessClientAddressCommand } from 'src/application/commands/ProcessClientAddressCommand';
import { FindPlayerQuery } from 'src/application/queries/FindPlayerQuery';
import Player from 'src/domain/aggregates/Player';
import { UpdatePlayerCommand } from 'src/application/commands/UpdatePlayerCommand';
import SessionId from 'src/domain/value-objects/SessionId';
import TitleId from 'src/domain/value-objects/TitleId';
import StateFlag, { StateFlags } from 'src/domain/value-objects/StateFlag';

@ApiTags('XNet')
@Controller()
export class XNetController {
  constructor(
    private readonly logger: ConsoleLogger,
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {
    this.logger.setContext(XNetController.name);
  }

  @Get('/whoami')
  @ApiQuery({ name: 'mac', description: 'Console MAC Address', required: false })
  async getClientAddress(@RealIP() ip: string, @Query('mac') mac?: string) {
    // Under GNS a console's online IP is the synthetic MAC-derived address, not
    // its real public IP. If the caller passes its MAC, return the authoritative
    // synthetic IP; otherwise fall back to the observed source IP (non-GNS).
    if (mac) {
      return { address: SyntheticIp.fromMac(new MacAddress(mac)).value };
    }

    const ipv4 = await this.commandBus.execute(
      new ProcessClientAddressCommand(ip),
    );

    return { address: ipv4 };
  }

  @Delete(['/DeleteSessions/:macAddress', '/DeleteSessions'])
  @ApiQuery({ name: 'hostAddress', description: 'IP Address', required: false })
  @ApiParam({ name: 'macAddress', description: 'Mac Address', required: false })
  async deleteAllSessions(
    @Query('hostAddress') hostAddress?: string,
    @Param('macAddress') macAddress?: string,
  ) {
    let mac: MacAddress = null;

    try {
      mac = new MacAddress(macAddress);
    } catch {
      // No (valid) MAC supplied; fall through to the hostAddress path below.
    }

    // Sessions/players are keyed by the synthetic (MAC-derived) hostAddress, not the
    // caller's real HTTP source IP. Resolve the delete target from the MAC (preferred)
    // or an explicitly-provided hostAddress. A bare call (no MAC, no hostAddress) has
    // no safe target: deleting by the real source IP would either no-op (sessions are
    // keyed by synthetic IP) or, behind a shared NAT/relay, risk another console's
    // sessions — so it is a deliberate no-op.
    let ipv4: string;

    if (mac) {
      ipv4 = SyntheticIp.fromMac(mac).value;
    } else if (hostAddress) {
      ipv4 = await this.commandBus.execute(
        new ProcessClientAddressCommand(hostAddress),
      );
    } else {
      this.logger.warn(
        'DeleteSessions called without a MAC or hostAddress; ignoring (a MAC is required to target sessions).',
      );
      return;
    }

    await this.commandBus.execute(
      new DeleteSessionsCommand(new IpAddress(ipv4), mac),
    );

    const player: Player = await this.queryBus.execute(
      new FindPlayerQuery(new IpAddress(ipv4)),
    );

    if (player) {
      const default_state = new StateFlag(
        StateFlags.ONLINE | StateFlags.JOINABLE | StateFlags.PLAYING,
      );

      player.setSession(new SessionId('0'.repeat(16)));
      player.setTitleId(new TitleId('0'));
      player.setState(default_state);
      player.setRichPresence('');

      await this.commandBus.execute(
        new UpdatePlayerCommand(player.xuid, player),
      );
    }
  }
}
