import { ConsoleLogger, Controller, Get } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import axios from 'axios';
import TurnSettings from '../settings/TurnSettings';
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
  @ApiQuery({
    name: 'mac',
    description: 'Console MAC Address',
    required: false,
  })
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

  // Short-lived Cloudflare Realtime TURN/STUN credentials for GNS ICE. The console fetches this at login
  // (alongside /whoami) and refreshes before expiry, using the values instead of its gns_stun_/gns_turn_
  // CVARs. The response is PRE-SPLIT and single-valued (the client repeats the one credential across the N
  // turn URLs -- GNS requires the user/pass list length to match the server list). Unset config or an
  // upstream failure returns an empty body so the client falls back to its CVAR defaults.
  @Get('/turn')
  async getTurnCredentials() {
    const empty = {
      stunServers: '',
      turnServers: '',
      turnUsername: '',
      turnCredential: '',
      ttl: 0,
    };

    const turn = new TurnSettings().get();
    if (!turn.keyId || !turn.apiToken) {
      return empty;
    }

    try {
      const resp = await axios.post(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${turn.keyId}/credentials/generate-ice-servers`,
        { ttl: turn.ttl },
        {
          headers: { Authorization: `Bearer ${turn.apiToken}` },
          timeout: 5000,
        },
      );

      // Cloudflare returns a WebRTC iceServers array: a STUN entry (urls only) and a TURN entry
      // (urls + username + credential). Split the urls by scheme and carry the single credential.
      const iceServers: any[] = resp.data?.iceServers ?? [];
      const stun: string[] = [];
      const turnUrls: string[] = [];
      let username = '';
      let credential = '';
      for (const s of iceServers) {
        const urls: string[] = Array.isArray(s?.urls)
          ? s.urls
          : s?.urls
            ? [s.urls]
            : [];
        for (const u of urls) {
          if (u.startsWith('stun:')) {
            stun.push(u);
          } else if (u.startsWith('turn:') || u.startsWith('turns:')) {
            turnUrls.push(u);
          }
        }
        if (s?.username) {
          username = s.username;
        }
        if (s?.credential) {
          credential = s.credential;
        }
      }

      return {
        stunServers: stun.join(','),
        turnServers: turnUrls.join(','),
        turnUsername: username,
        turnCredential: credential,
        ttl: turn.ttl,
      };
    } catch (error) {
      this.logger.error(`TURN credential generation failed: ${error?.message}`);
      return empty;
    }
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
