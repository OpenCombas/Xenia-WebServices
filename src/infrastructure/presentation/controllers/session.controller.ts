import {
  Controller,
  Get,
  Delete,
  NotFoundException,
  Param,
  RawBodyRequest,
  ForbiddenException,
  HttpStatus,
  ConsoleLogger,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import TitleId from 'src/domain/value-objects/TitleId';
import { Body, Post, Query, Req, Res } from '@nestjs/common/decorators';
import { CreateSessionRequest } from '../requests/CreateSessionRequest';
import { CreateSessionCommand } from 'src/application/commands/CreateSessionCommand';
import SessionId from 'src/domain/value-objects/SessionId';
import IpAddress from 'src/domain/value-objects/IpAddress';
import SyntheticIp from 'src/domain/value-objects/SyntheticIp';
import SessionFlags from 'src/domain/value-objects/SessionFlags';
import { GetSessionQuery } from 'src/application/queries/GetSessionQuery';
import { SessionSearchQuery } from 'src/application/queries/SessionSearchQuery';
import SessionPresentationMapper from '../mappers/SessionPresentationMapper';
import MacAddress from 'src/domain/value-objects/MacAddress';
import { ModifySessionCommand } from 'src/application/commands/ModifySessionCommand';
import { ModifySessionRequest } from '../requests/ModifySessionRequest';
import { JoinSessionCommand } from 'src/application/commands/JoinSessionCommand';
import { JoinSessionRequest } from '../requests/JoinSessionRequest';
import { GetSessionContextRequest } from '../requests/GetSessionContextRequest';
import { GetSessionPropertyRequest } from '../requests/GetSessionPropertyRequest';
import Xuid from 'src/domain/value-objects/Xuid';
import { SessionSearchRequest } from '../requests/SessionSearchRequest';
import { SessionDetailsResponse } from '../responses/SessionDetailsResponse';
import { LeaveSessionRequest } from '../requests/LeaveSessionRequest';
import { LeaveSessionCommand } from 'src/application/commands/LeaveSessionCommand';
import { DeleteSessionCommand } from 'src/application/commands/DeleteSessionCommand';
import { AddSessionContextCommand } from 'src/application/commands/AddSessionContextCommand';
import { AddSessionPropertyCommand } from 'src/application/commands/AddSessionPropertyCommand';
import { SessionArbitrationResponse } from '../responses/SessionArbitrationResponse';
import { SessionContextResponse } from '../responses/SessionContextResponse';
import { SessionPropertyResponse } from '../responses/SessionPropertyResponse';
import Player from 'src/domain/aggregates/Player';
import { GetPlayerQuery } from 'src/application/queries/GetPlayerQuery';
import { FindPlayerQuery } from 'src/application/queries/FindPlayerQuery';
import { Request, Response } from 'express';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { UpdateLeaderboardCommand } from 'src/application/commands/UpdateLeaderboardCommand';
import LeaderboardId from 'src/domain/value-objects/LeaderboardId';
import { WriteStatsRequest } from '../requests/WriteStatsRequest';
import PropertyId from 'src/domain/value-objects/PropertyId';
import { LeaderboardUpdateProps } from 'src/domain/aggregates/Leaderboard';
import { MigrateSessionCommand } from 'src/application/commands/MigrateSessionCommand';
import { MigrateSessionRequest } from '../requests/MigrateSessionRequest';
import { RealIP } from 'nestjs-real-ip';
import { ProcessClientAddressCommand } from 'src/application/commands/ProcessClientAddressCommand';
import Session from 'src/domain/aggregates/Session';
import { UpdatePlayerCommand } from 'src/application/commands/UpdatePlayerCommand';
import { GetTitleSessionsQuery } from 'src/application/queries/GetTitleSessionsQuery';
import SessionDetailsPresentationMapper from '../mappers/SessionDetailsPresentationMapper';
import { PreJoinRequest } from '../requests/PreJoinRequest';
import Property, { X_USER_DATA_TYPE } from 'src/domain/value-objects/Property';
import { StateFlags } from 'src/domain/value-objects/StateFlag';

@ApiTags('Sessions')
@Controller('/title/:titleId/sessions')
export class SessionController {
  constructor(
    private readonly logger: ConsoleLogger,
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    private readonly sessionMapper: SessionPresentationMapper,
    private readonly sessionDetailsMapper: SessionDetailsPresentationMapper,
  ) {
    this.logger.setContext(SessionController.name);
  }

  // Follow a session's migration hand-off chain to the current (live) session, so a
  // caller holding a migrated-away id (a cached search result or squad roster entry)
  // is steered to the new host instead of reading the departed host's stale,
  // soft-deleted session. Guards against cycles / unbounded chains.
  private async resolveLiveSession(
    titleId: TitleId,
    session: Session,
  ): Promise<Session> {
    const seen = new Set<string>();

    while (session?.migration && !seen.has(session.id.value)) {
      seen.add(session.id.value);

      const next: Session = await this.queryBus.execute(
        new GetSessionQuery(titleId, session.migration),
      );

      if (!next) {
        break;
      }

      session = next;
    }

    return session;
  }

  @Post()
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  async createSession(
    @Param('titleId') titleId: string,
    @Body() request: CreateSessionRequest,
  ) {
    const flags = new SessionFlags(request.flags);

    if (flags.isHost) {
      this.logger.verbose('Host creating session: ' + request.sessionId);

      // Server-authoritative online IP: derive from the host MAC so the session's
      // published hostAddress equals SyntheticInaFromPeerKey(MAC) — matching the
      // host's GNS advertise and the joiner's XNetXnAddrToInAddr mapping.
      const macAddress = new MacAddress(request.macAddress);
      const hostAddress: IpAddress = SyntheticIp.fromMac(macAddress);

      let player: Player;

      if (request.xuid) {
        player = await this.queryBus.execute(
          new GetPlayerQuery(new Xuid(request.xuid)),
        );
      } else {
        // Fallback for backwards compatibility older netplay builds don't provide xuid.
        // Look up by the derived synthetic IP so it matches the stored player.
        player = await this.queryBus.execute(new FindPlayerQuery(hostAddress));
      }

      // If player is not registered then refuse to create session.
      if (!player) {
        const error_msg = `Player not found: ${request.xuid ? request.xuid : request.hostAddress}`;
        this.logger.error(error_msg);

        throw new ForbiddenException(error_msg);
      }

      await this.commandBus.execute(
        new CreateSessionCommand(
          new TitleId(titleId),
          request.xuid ? new Xuid(request.xuid) : undefined,
          request.title,
          request.mediaId,
          request.version,
          new SessionId(request.sessionId),
          hostAddress,
          new SessionFlags(request.flags),
          request.publicSlotsCount,
          request.privateSlotsCount,
          macAddress,
          request.port,
        ),
      );

      if (flags.isStatsSession) {
        this.logger.verbose('Updating Stats.');
      }

      // 5841128F needs friends only flag to discover sessions.
      // If session is friends only then set friends only state for host.
      if (flags.isFriendsOnly) {
        player.state.setFriendsOnly();
      }

      // If player doesn't exists add them to players table
      if (flags.isAdvertised) {
        player.setSession(new SessionId(request.sessionId));

        await this.commandBus.execute(
          new UpdatePlayerCommand(player.xuid, player),
        );
      } else {
        this.logger.verbose(`Skip updating presence`);
      }
    } else {
      this.logger.verbose(`Peer joining session: ${request.sessionId}`);

      const session = await this.queryBus.execute(
        new GetSessionQuery(
          new TitleId(titleId),
          new SessionId(request.sessionId),
        ),
      );

      if (!session) {
        this.logger.error(`Session ${request.sessionId} was not found.`);
      }
    }
  }

  @Get('/search')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  async GetTitleSessions(@Param('titleId') titleId: string) {
    const sessions: Session[] = await this.queryBus.execute(
      new GetTitleSessionsQuery(new TitleId(titleId)),
    );

    return sessions.map(this.sessionDetailsMapper.CreateSessionDetails);
  }

  @Get('/:sessionId')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async getSession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
  ) {
    let session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    // If this session has been migrated to a new host, return the live one.
    session = await this.resolveLiveSession(new TitleId(titleId), session);

    return this.sessionMapper.mapToPresentationModel(session);
  }

  @Post('/:sessionId/migrate')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async migrateSession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: MigrateSessionRequest,
  ) {
    const session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    // Server-authoritative online IP: derive from the (new) host MAC, as in create.
    const macAddress = new MacAddress(request.macAddress);

    const newSession: Session = await this.commandBus.execute(
      new MigrateSessionCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        request.xuid ? new Xuid(request.xuid) : undefined,
        SyntheticIp.fromMac(macAddress),
        macAddress,
        request.port,
      ),
    );

    if (request.xuid) {
      const player: Player = await this.queryBus.execute(
        new GetPlayerQuery(new Xuid(request.xuid)),
      );

      const flags = new SessionFlags(session.flags.value);

      if (player && flags.isAdvertised) {
        player.setSession(newSession.id);

        await this.commandBus.execute(
          new UpdatePlayerCommand(player.xuid, player),
        );
      } else {
        this.logger.verbose(`Skip updating presence`);
      }
    }

    return this.sessionMapper.mapToPresentationModel(newSession);
  }

  @Delete('/:sessionId')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  @ApiQuery({
    name: 'macAddress',
    description: 'Host MAC Address',
    required: false,
  })
  async deleteSession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @RealIP() ip: string,
    @Query('macAddress') macAddress?: string,
  ) {
    const session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      this.logger.debug(`Session ${sessionId} is already deleted.`);
      return;
    }

    // Ownership check. The session's hostAddress is now the synthetic (MAC-derived)
    // online IP, which no longer equals the caller's real HTTP source IP — so we
    // authorize by MAC when the client supplies it (the session stores the host
    // MAC), and fall back to the legacy RealIP compare for older clients.
    let authorized: boolean;
    let requester: string;

    if (macAddress) {
      requester = macAddress.toUpperCase();
      authorized = session.macAddress.value === requester;
    } else {
      requester = await this.commandBus.execute(
        new ProcessClientAddressCommand(ip),
      );
      authorized = session.hostAddress.value === requester;
    }

    if (!authorized) {
      this.logger.debug(
        `Client ${requester} attempted to delete session created by ${
          macAddress ? session.macAddress.value : session.hostAddress.value
        }`,
      );
      this.logger.debug(`Session ${sessionId} will not be deleted.`);
      return;
    }

    const deleted_session: Session = await this.commandBus.execute(
      new DeleteSessionCommand(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (deleted_session.HasProperties()) {
      const host: Player = await this.queryBus.execute(
        new GetPlayerQuery(deleted_session.getHostXUID),
      );

      // Remove friends only state it's no longer needed
      if (host && host.state.isFriendsOnly()) {
        host.state.removeFlag(StateFlags.FRIENDS_ONLY);
        await this.commandBus.execute(new UpdatePlayerCommand(host.xuid, host));
      }
    }

    // Reset player's session id and title id when they delete a session.
    // Problem is supporting multiple session instances

    if (!deleted_session.deleted) {
      throw new NotFoundException(
        `Failed to soft delete session ${sessionId}.`,
      );
    }
  }

  @Get('/:sessionId/details')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async getSessionDetails(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionDetailsResponse> {
    let session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    // If this session has been migrated to a new host, return the live one so late
    // joiners connect to the current host rather than the departed one.
    session = await this.resolveLiveSession(new TitleId(titleId), session);

    const xuids: string[] = Array.from(session.players.keys());

    return {
      id: session.id.value,
      flags: session.flags.value,
      hostAddress: session.hostAddress.value,
      port: session.port,
      macAddress: session.macAddress.value,
      publicSlotsCount: session.publicSlotsCount,
      privateSlotsCount: session.privateSlotsCount,
      openPublicSlotsCount: session.availablePublicSlots,
      openPrivateSlotsCount: session.availablePrivateSlots,
      filledPublicSlotsCount: session.filledPublicSlots,
      filledPrivateSlotsCount: session.filledPrivateSlots,
      players: xuids.map((xuid) => ({ xuid: xuid })),
    };
  }

  @Get('/:sessionId/arbitration')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async getSessionArbitration(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionArbitrationResponse> {
    const session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    const xuids: string[] = Array.from(session.players.keys());

    const players: Player[] = await Promise.all(
      xuids.map((xuid) => {
        return this.queryBus.execute(new GetPlayerQuery(new Xuid(xuid)));
      }),
    );

    const machinePlayers = {};

    players
      .filter((player) => player != undefined)
      .forEach((player) => {
        if (machinePlayers[player.machineId.value] !== undefined) {
          machinePlayers[player.machineId.value].push(player);
        } else {
          machinePlayers[player.machineId.value] = [player];
        }
      });

    const machines: SessionArbitrationResponse['machines'] = [];

    for (const [key, value] of Object.entries(machinePlayers)) {
      machines.push({
        id: key,
        players: (value as Player[]).map((player: Player) => {
          return { xuid: player.xuid.value };
        }),
      });
    }

    return {
      totalPlayers: players.length,
      machines,
    };
  }

  @Post('/:sessionId/modify')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async modifySession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: ModifySessionRequest,
  ) {
    const flags: SessionFlags = new SessionFlags(request.flags);

    const session: Session = await this.commandBus.execute(
      new ModifySessionCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        flags,
        request.publicSlotsCount,
        request.privateSlotsCount,
      ),
    );

    if (session && session.HasProperties()) {
      const host: Player = await this.queryBus.execute(
        new GetPlayerQuery(session.getHostXUID),
      );

      if (host) {
        let update_state: boolean = true;

        // If friends only flag was set, then set friends only flag to host state
        if (flags.isFriendsOnly && !host.state.isFriendsOnly()) {
          host.state.setFriendsOnly();
        } else if (!flags.isFriendsOnly && host.state.isFriendsOnly()) {
          host.state.removeFlag(StateFlags.FRIENDS_ONLY);
        } else {
          update_state = false;
        }

        if (update_state) {
          await this.commandBus.execute(
            new UpdatePlayerCommand(host.xuid, host),
          );
        }
      }
    }

    if (!session) {
      throw new NotFoundException(
        `Failed to modify session ${sessionId} was not found.`,
      );
    }
  }

  @Post('/:sessionId/join')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async joinSession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: JoinSessionRequest,
  ) {
    const members = new Map<Xuid, boolean>();

    request.xuids.forEach((xuid, index) => {
      // Default to public slot if slots are not provided
      const is_private: boolean = request.privateSlots
        ? request.privateSlots[index]
        : false;

      if (!request.privateSlots) {
        this.logger.debug('Defaulting to public slot');
      }

      members.set(new Xuid(xuid), is_private);
    });

    const session: Session = await this.commandBus.execute(
      new JoinSessionCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        members,
      ),
    );

    if (!session) {
      const error_msg = `Failed to join session ${sessionId} was not found.`;
      this.logger.debug(error_msg);

      throw new NotFoundException(error_msg);
    }

    const players_xuid = request.xuids.map((xuid) => xuid);

    const xuids: PreJoinRequest = {
      xuids: players_xuid,
    };

    await this.preJoin(titleId, sessionId, xuids);
  }

  @Post('/:sessionId/prejoin')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async preJoin(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: PreJoinRequest,
  ) {
    // Update joining players sessionId
    const players_xuid = request.xuids.map((xuid) => new Xuid(xuid));

    for (const player_xuid of players_xuid) {
      const player: Player = await this.queryBus.execute(
        new GetPlayerQuery(player_xuid),
      );

      if (player) {
        player.setSession(new SessionId(sessionId));
        player.setTitleId(new TitleId(titleId));

        await this.commandBus.execute(
          new UpdatePlayerCommand(player.xuid, player),
        );
      }
    }
  }

  @Post('/:sessionId/leave')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async leaveSession(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: LeaveSessionRequest,
  ) {
    const session: Session = await this.commandBus.execute(
      new LeaveSessionCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        request.xuids.map((xuid) => new Xuid(xuid)),
      ),
    );

    if (!session) {
      const error_msg = `Failed to leave session ${sessionId} was not found.`;
      this.logger.debug(error_msg);

      throw new NotFoundException(error_msg);
    }

    // Problem is supporting multiple session instances

    // Update leaving players
    // Reset player's session id when they leave a session.
    const players_xuid = request.xuids.map((xuid) => new Xuid(xuid));

    for (const player_xuid of players_xuid) {
      const player: Player = await this.queryBus.execute(
        new GetPlayerQuery(player_xuid),
      );

      const flags = new SessionFlags(session.flags.value);

      if (player && flags.isAdvertised) {
        player.setSession(new SessionId('0'.repeat(16)));

        await this.commandBus.execute(
          new UpdatePlayerCommand(player.xuid, player),
        );
      } else {
        this.logger.verbose(`Skip updating presence`);
      }
    }
  }

  @Post('/search')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  async sessionSearch(
    @Param('titleId') titleId: string,
    @Body() request: SessionSearchRequest,
  ) {
    let sessions: Array<Session> = await this.queryBus.execute(
      new SessionSearchQuery(
        new TitleId(titleId),
        request.searchIndex,
        request.resultsCount,
        request.numUsers,
      ),
    );

    // It would be more efficient if we could filter the query itself.
    sessions = sessions.filter((session) => {
      return session.getHostXUID.value != request.searcher_xuid;
    });

    return sessions.map(this.sessionMapper.mapToPresentationModel);
  }

  @Post('/:sessionId/qos')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async qosUpload(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Systemlink session documents aren't stored on the backend.
    const session_id: SessionId = new SessionId(sessionId);

    const qosPath = join(process.cwd(), 'qos', titleId, sessionId);

    if (existsSync(qosPath)) {
      this.logger.verbose(`${session_id.GetTypeString()}: Updating QoS Data.`);
    } else {
      await mkdir(join(process.cwd(), 'qos', titleId), { recursive: true });
      this.logger.verbose(`${session_id.GetTypeString()}: Saving QoS Data.`);
    }

    // always write QoS data to ensure data is updated.
    await writeFile(qosPath, req.rawBody);
  }

  @Get('/:sessionId/qos')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async qosDownload(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ) {
    const path = join(process.cwd(), 'qos', titleId, sessionId);

    if (!existsSync(path)) {
      res.set('Content-Length', '0');
      res.sendStatus(HttpStatus.NO_CONTENT);
      return;
    }

    const stats = await stat(path);

    if (!stats.isFile()) {
      throw new NotFoundException(`QoS data at ${path} not found.`);
    }

    res.set('Content-Length', stats.size.toString());
    const stream = createReadStream(path);
    stream.pipe(res);
  }

  @Post('/:sessionId/context')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async sessionContextSet(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: GetSessionContextRequest,
  ) {
    const session: Session = await this.commandBus.execute(
      new AddSessionContextCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        request.contexts,
      ),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }
  }

  @Get('/:sessionId/context')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async sessionContextGet(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionContextResponse> {
    const session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    return {
      context: session.context,
    };
  }

  @Post('/:sessionId/properties')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async sessionPropertySet(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: GetSessionPropertyRequest,
  ) {
    // Extract properties and exclude contexts
    const properties: Array<Property> = request.properties
      .filter((base64: string) => {
        const prop: Property = new Property(base64);

        return prop.type != X_USER_DATA_TYPE.CONTEXT;
      })
      .map((base64: string) => {
        return new Property(base64);
      });

    // Extract contexts from properties
    const contexts: Array<{ contextId: number; value: number }> =
      request.properties
        .filter((base64: string) => {
          const prop: Property = new Property(base64);

          return prop.type == X_USER_DATA_TYPE.CONTEXT;
        })
        .map((base64: string) => {
          const prop: Property = new Property(base64);
          const value = prop.getData().readUInt32BE();

          return { contextId: prop.id, value: value };
        });

    const session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    // Print only after initializing properties and contexts but before updating.
    if (session.HasProperties() || session.HasContexts()) {
      session.PrettyPrintPropertiesAndContextsUpdateTable(properties, contexts);
    }

    const context_session: Session = await this.commandBus.execute(
      new AddSessionContextCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        contexts,
      ),
    );

    const properties_session: Session = await this.commandBus.execute(
      new AddSessionPropertyCommand(
        new TitleId(titleId),
        new SessionId(sessionId),
        properties,
      ),
    );

    properties_session.PrettyPrintPropertiesTable();
  }

  @Get('/:sessionId/properties')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async sessionPropertyGet(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionPropertyResponse> {
    const session: Session = await this.queryBus.execute(
      new GetSessionQuery(new TitleId(titleId), new SessionId(sessionId)),
    );

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} was not found.`);
    }

    return {
      properties: session.propertiesStringArray,
    };
  }

  @Post('/:sessionId/leaderboards')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @ApiParam({ name: 'sessionId', example: 'AE00000000000000' })
  async postLeaderboards(
    @Param('titleId') titleId: string,
    @Param('sessionId') sessionId: string,
    @Body() request: WriteStatsRequest,
  ) {
    this.logger.verbose(
      '\n' + JSON.stringify({ request: JSON.stringify(request) }),
    );

    const statsConfigPath = join(
      process.cwd(),
      './src/titles',
      titleId.toUpperCase(),
      'stats.json',
    );

    if (!existsSync(statsConfigPath)) {
      this.logger.warn(
        `No stats config found for title ${titleId}, unable to save stats.`,
      );

      return;
    }

    const statsConfig = JSON.parse(readFileSync(statsConfigPath, 'utf8'));
    const propertyMappings = statsConfig.properties;

    // Which views are ARBITRATED, i.e. reported redundantly by every session member so the service can
    // cross-check them. Two sources, mirroring Xenia's own test
    // (IsTrueSkillViewID(view_id) || spa_view.view.arbitrated):
    //   * the reserved TrueSkill view 0xFFFF0000, arbitrated by definition and not declared in any SPA view
    //   * any view the title's SPA declares arbitrated, surfaced in the config's _leaderboards block
    // Everything else is submitted by exactly one authoritative console, so it must NOT be de-duplicated --
    // FlushStats sends non-arbitrated views incrementally during play, and those repeats are legitimate
    // progressive updates carrying different values.
    const TRUESKILL_VIEW_ID = '4294901760'; // 0xFFFF0000
    const arbitratedViewIds = new Set<string>([TRUESKILL_VIEW_ID]);
    for (const board of statsConfig._leaderboards ?? []) {
      if (board.arbitrated && board.viewId) {
        arbitratedViewIds.add(String(parseInt(board.viewId, 16)));
      }
    }

    await Promise.all(
      Object.entries(request.leaderboards).map(
        async ([leaderboardId, leaderboard]) => {
          const stats: LeaderboardUpdateProps['stats'] = {};
          Object.entries(leaderboard.stats).forEach(([propId, stat]) => {
            const propertyMapping =
              propertyMappings[new PropertyId(propId).toString()];

            if (!propertyMapping) {
              this.logger.warn('UNKNOWN STAT ID FOR PROPERTY ' + propId);
              return;
            }

            const statId = propertyMapping.statId;

            stats[`${statId}`] = {
              ...stat,
              method: propertyMapping.method,
            };
          });

          return await this.commandBus.execute(
            new UpdateLeaderboardCommand(
              new LeaderboardId(leaderboardId),
              new TitleId(titleId),
              new Xuid(request.xuid),
              stats,
              sessionId,
              arbitratedViewIds.has(leaderboardId),
            ),
          );
        },
      ),
    );
  }
}
