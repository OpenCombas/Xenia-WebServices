import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Friendship, FriendshipDocument } from './schemas/friendship.schema';
import { IPlayerRepositorySymbol } from 'src/domain/repositories/IPlayerRepository';
import type IPlayerRepository from 'src/domain/repositories/IPlayerRepository';
import Xuid from 'src/domain/value-objects/Xuid';
import Gamertag from 'src/domain/value-objects/Gamertag';
import { FriendPresence, FriendsResponse } from './dto/friends.dto';
import { EventsService } from '../events/events.service';

// --- pure helpers (unit-tested; no I/O) ---

// Order a pair canonically so a relationship is one row regardless of arg order.
export function canonicalPair(
  a: string,
  b: string,
): { xuidLow: string; xuidHigh: string } {
  return a <= b ? { xuidLow: a, xuidHigh: b } : { xuidLow: b, xuidHigh: a };
}

// The other party of a canonical pair, from `xuid`'s perspective.
export function otherOf(
  pair: { xuidLow: string; xuidHigh: string },
  xuid: string,
): string {
  return pair.xuidLow === xuid ? pair.xuidHigh : pair.xuidLow;
}

@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship.name)
    private readonly friendships: Model<FriendshipDocument>,
    @Inject(IPlayerRepositorySymbol)
    private readonly players: IPlayerRepository,
    private readonly events: EventsService,
  ) {}

  // Send a friend request (by xuid or gamertag). A reciprocal pending auto-accepts.
  async request(
    fromXuid: string,
    toXuid?: string,
    toGamertag?: string,
  ): Promise<{ status: 'pending' | 'accepted' }> {
    const from = new Xuid(fromXuid).value;
    const to = await this.resolveTarget(toXuid, toGamertag);
    if (from === to) {
      throw new BadRequestException({
        error: 'self_request',
        message: 'cannot friend yourself',
      });
    }
    const pair = canonicalPair(from, to);
    const existing = await this.friendships.findOne(pair);
    if (existing) {
      if (existing.status === 'accepted') {
        throw new ConflictException({
          error: 'already_friends',
          message: `${from} and ${to} are already friends`,
        });
      }
      if (existing.requesterXuid === to) {
        // The other side already requested me -> this request accepts it.
        existing.status = 'accepted';
        await existing.save();
        await this.emitAccepted(from, to);
        return { status: 'accepted' };
      }
      return { status: 'pending' }; // idempotent re-request
    }
    await this.friendships.create({
      ...pair,
      requesterXuid: from,
      status: 'pending',
    });
    this.events.push(to, {
      type: 'friend.request',
      payload: { fromXuid: from, fromGamertag: await this.gamertagFor(from) },
    });
    return { status: 'pending' };
  }

  // The RECIPIENT accepts a pending request -> the pair becomes symmetric friends.
  async accept(
    xuid: string,
    otherXuid: string,
  ): Promise<{ status: 'accepted' }> {
    const me = new Xuid(xuid).value;
    const other = new Xuid(otherXuid).value;
    const pair = canonicalPair(me, other);
    const f = await this.friendships.findOne({ ...pair, status: 'pending' });
    // Only the recipient (not the requester) can accept.
    if (!f || f.requesterXuid !== other) {
      throw new NotFoundException({
        error: 'no_pending_request',
        message: `no pending request from ${other} for ${me} to accept`,
      });
    }
    f.status = 'accepted';
    await f.save();
    await this.emitAccepted(me, other);
    return { status: 'accepted' };
  }

  // decline / cancel / remove all delete the relationship (any status), either side.
  async remove(xuid: string, otherXuid: string): Promise<{ ok: true }> {
    const me = new Xuid(xuid).value;
    const other = new Xuid(otherXuid).value;
    await this.friendships.deleteOne(canonicalPair(me, other));
    this.events.push(other, { type: 'friend.removed', payload: { xuid: me } });
    return { ok: true };
  }

  // Both sides learn they're now friends (each gets the OTHER's identity).
  private async emitAccepted(a: string, b: string): Promise<void> {
    const [ga, gb] = await Promise.all([
      this.gamertagFor(a),
      this.gamertagFor(b),
    ]);
    this.events.push(a, {
      type: 'friend.accepted',
      payload: { xuid: b, gamertag: gb },
    });
    this.events.push(b, {
      type: 'friend.accepted',
      payload: { xuid: a, gamertag: ga },
    });
  }

  // The poll: a player's accepted friends (with presence) + pending requests.
  async list(xuid: string): Promise<FriendsResponse> {
    const me = new Xuid(xuid).value;
    const rows = await this.friendships.find({
      $or: [{ xuidLow: me }, { xuidHigh: me }],
    });
    const friends: FriendPresence[] = [];
    const incoming: FriendsResponse['incoming'] = [];
    const outgoing: FriendsResponse['outgoing'] = [];
    for (const r of rows) {
      const other = otherOf(r, me);
      if (r.status === 'accepted') {
        friends.push(await this.presenceFor(other));
      } else if (r.requesterXuid === me) {
        outgoing.push({ toXuid: other, toGamertag: await this.gamertagFor(other) });
      } else {
        incoming.push({
          fromXuid: other,
          fromGamertag: await this.gamertagFor(other),
        });
      }
    }
    return { friends, incoming, outgoing };
  }

  // --- helpers ---

  private async resolveTarget(
    toXuid?: string,
    toGamertag?: string,
  ): Promise<string> {
    if (toXuid) return new Xuid(toXuid).value;
    if (toGamertag) {
      const p = await this.players.findByGamertag(new Gamertag(toGamertag));
      if (!p) {
        throw new NotFoundException({
          error: 'user_not_found',
          message: `no player with gamertag ${toGamertag}`,
        });
      }
      return p.xuid.value;
    }
    throw new BadRequestException({
      error: 'missing_target',
      message: 'provide toXuid or toGamertag',
    });
  }

  private async presenceFor(xuid: string): Promise<FriendPresence> {
    const online = this.events.isOnline(xuid);
    const p = await this.players.findByXuid(new Xuid(xuid));
    if (!p) {
      // No login record (never logged in / TTL-expired) -> minimal, DB-offline.
      return {
        xuid,
        gamertag: '',
        state: 0,
        sessionId: '',
        titleId: '0',
        stateChangeTime: 0,
        richPresence: '',
        online,
      };
    }
    return {
      xuid: p.xuid.value,
      gamertag: p.gamertag ? p.gamertag.value : '',
      state: p.state ? p.state.value : 0,
      sessionId: p.sessionId ? p.sessionId.value : '',
      titleId: p.titleId ? p.titleId.toString() : '0',
      stateChangeTime: 0,
      richPresence: p.richPresence ?? '',
      online,
    };
  }

  private async gamertagFor(xuid: string): Promise<string> {
    const p = await this.players.findByXuid(new Xuid(xuid));
    return p && p.gamertag ? p.gamertag.value : '';
  }
}
