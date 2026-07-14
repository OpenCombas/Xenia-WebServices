import { ConsoleLogger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { EventsService } from './events.service';
import { PartyService } from '../party/party.service';
import { FriendsService } from '../friends/friends.service';
import Xuid from 'src/domain/value-objects/Xuid';

interface IdentifiedSocket extends WebSocket {
  xuid?: string;
  isAlive?: boolean;
}

// The live-events WebSocket. Auth = `wss://host/events?xuid=X` (xuid-trusting, like
// the rest of the API). On connect it snapshots the console's current party+friends
// state, then the party/friends services push deltas via EventsService. Presence =
// this socket's lifecycle. Actions stay HTTP.
@WebSocketGateway({ path: '/events' })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  private server: Server;

  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly events: EventsService,
    private readonly party: PartyService,
    private readonly friends: FriendsService,
    private readonly logger: ConsoleLogger,
  ) {
    this.logger.setContext(EventsGateway.name);
    this.startHeartbeat();
  }

  async handleConnection(
    client: IdentifiedSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const xuid = this.extractXuid(req);
    if (!xuid) {
      client.close(1008, 'missing or invalid xuid');
      return;
    }
    client.xuid = xuid;
    client.isAlive = true;
    client.on('pong', () => {
      client.isAlive = true;
    });
    this.events.register(xuid, client);
    this.logger.log(`WS connect: ${xuid}`);

    const snapshot = await this.snapshotFor(xuid);
    client.send(JSON.stringify({ type: 'snapshot', payload: snapshot }));

    // Tell this console's friends + party members it's online.
    this.events.pushMany(this.interested(snapshot), {
      type: 'presence',
      payload: { xuid, online: true },
    });
  }

  async handleDisconnect(client: IdentifiedSocket): Promise<void> {
    const xuid = client.xuid;
    if (!xuid) return;
    const wentOffline = this.events.unregister(xuid, client);
    this.logger.log(`WS disconnect: ${xuid}${wentOffline ? ' (offline)' : ''}`);
    if (wentOffline) {
      const snapshot = await this.snapshotFor(xuid);
      this.events.pushMany(this.interested(snapshot), {
        type: 'presence',
        payload: { xuid, online: false },
      });
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  private extractXuid(req: IncomingMessage): string | null {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const raw = url.searchParams.get('xuid');
      return raw ? new Xuid(raw).value : null;
    } catch {
      return null;
    }
  }

  private async snapshotFor(xuid: string) {
    const [party, friends] = await Promise.all([
      this.party.poll(xuid),
      this.friends.list(xuid),
    ]);
    return {
      party: party.party,
      partyInvites: party.invites,
      friends: friends.friends,
      incoming: friends.incoming,
      outgoing: friends.outgoing,
    };
  }

  // Who cares about this console's presence: its friends + current party members.
  private interested(
    snapshot: Awaited<ReturnType<EventsGateway['snapshotFor']>>,
  ): Set<string> {
    const set = new Set<string>();
    for (const f of snapshot.friends) set.add(f.xuid);
    if (snapshot.party) for (const m of snapshot.party.members) set.add(m.xuid);
    return set;
  }

  // ws-standard ping/pong reaper: a socket that didn't pong since the last tick is
  // terminated (→ handleDisconnect). No scheduler dep; a self-contained interval.
  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      if (!this.server) return;
      for (const client of this.server.clients) {
        const c = client as IdentifiedSocket;
        if (c.isAlive === false) {
          c.terminate();
          continue;
        }
        c.isAlive = false;
        c.ping();
      }
    }, 30_000);
  }
}
