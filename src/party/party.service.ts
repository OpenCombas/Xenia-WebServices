import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Party, PartyDocument, PartyMember } from './schemas/party.schema';
import {
  PartyInvite,
  PartyInviteDocument,
} from './schemas/party-invite.schema';
import { IPlayerRepositorySymbol } from 'src/domain/repositories/IPlayerRepository';
import type IPlayerRepository from 'src/domain/repositories/IPlayerRepository';
import Xuid from 'src/domain/value-objects/Xuid';
import { PartyResponse, PollResponse } from './dto/party.dto';
import { EventsService } from '../events/events.service';

// Full-mesh Opus stays sane at a small friend-party size.
export const MAX_PARTY_MEMBERS = 8;
// A member reaped after this long without a poll (the poll is the only heartbeat).
export const MEMBER_REAP_MS = 30_000;

// --- pure decision helpers (unit-tested; no I/O) ---

export function isPartyFull(memberCount: number): boolean {
  return memberCount >= MAX_PARTY_MEMBERS;
}

// Members that have polled within reapMs. Stamp the caller's lastPoll to `now`
// BEFORE calling this so the caller is always retained.
export function reapStaleMembers<T extends { lastPoll: Date }>(
  members: T[],
  now: number,
  reapMs: number = MEMBER_REAP_MS,
): T[] {
  return members.filter((m) => now - new Date(m.lastPoll).getTime() <= reapMs);
}

// A party dissolves when it is empty or its owner is gone (owner-leave semantics —
// an owner who stops polling is treated as having left).
export function shouldDissolve(
  members: { xuid: string }[],
  ownerXuid: string,
): boolean {
  return members.length === 0 || !members.some((m) => m.xuid === ownerXuid);
}

@Injectable()
export class PartyService {
  constructor(
    @InjectModel(Party.name) private readonly parties: Model<PartyDocument>,
    @InjectModel(PartyInvite.name)
    private readonly invites: Model<PartyInviteDocument>,
    @Inject(IPlayerRepositorySymbol)
    private readonly players: IPlayerRepository,
    private readonly events: EventsService,
  ) {}

  async create(ownerXuid: string): Promise<PartyResponse> {
    const existing = await this.parties.findOne({ 'members.xuid': ownerXuid });
    if (existing) {
      throw new ConflictException({
        error: 'already_in_party',
        message: `${ownerXuid} is already in a party`,
      });
    }
    const owner = await this.memberFor(ownerXuid);
    const party = await this.parties.create({
      partyId: randomUUID(),
      ownerXuid,
      members: [owner],
      lastActivity: new Date(),
    });
    return this.toResponse(party);
  }

  async invite(
    partyId: string,
    fromXuid: string,
    targetXuid: string,
  ): Promise<{ ok: true }> {
    const party = await this.requireParty(partyId);
    if (!party.members.some((m) => m.xuid === fromXuid)) {
      throw new ForbiddenException({
        error: 'not_a_member',
        message: `${fromXuid} is not in party ${partyId}`,
      });
    }
    if (isPartyFull(party.members.length)) {
      throw new ConflictException({
        error: 'party_full',
        message: `party ${partyId} is full`,
      });
    }
    if (party.members.some((m) => m.xuid === targetXuid)) {
      throw new ConflictException({
        error: 'already_member',
        message: `${targetXuid} is already in party ${partyId}`,
      });
    }
    const from = party.members.find((m) => m.xuid === fromXuid);
    await this.invites.updateOne(
      { partyId, targetXuid },
      { $set: { fromXuid, fromGamertag: from.gamertag, createdAt: new Date() } },
      { upsert: true },
    );
    this.events.push(targetXuid, {
      type: 'party.invite',
      payload: { partyId, fromXuid, fromGamertag: from.gamertag },
    });
    await this.touch(party);
    return { ok: true };
  }

  async join(partyId: string, xuid: string): Promise<PartyResponse> {
    const invite = await this.invites.findOne({ partyId, targetXuid: xuid });
    if (!invite) {
      throw new NotFoundException({
        error: 'no_pending_invite',
        message: `no pending invite for ${xuid} to party ${partyId}`,
      });
    }
    const party = await this.requireParty(partyId);
    if (!party.members.some((m) => m.xuid === xuid)) {
      if (isPartyFull(party.members.length)) {
        throw new ConflictException({
          error: 'party_full',
          message: `party ${partyId} is full`,
        });
      }
      party.members.push(await this.memberFor(xuid));
    }
    party.lastActivity = new Date();
    await party.save();
    await this.invites.deleteOne({ partyId, targetXuid: xuid });
    this.emitRoster(party);
    return this.toResponse(party);
  }

  async leave(
    partyId: string,
    xuid: string,
  ): Promise<{ ok: true; dissolved: boolean }> {
    const party = await this.parties.findOne({ partyId });
    if (!party) {
      return { ok: true, dissolved: true };
    }
    const remaining = party.members.filter((m) => m.xuid !== xuid);
    if (party.ownerXuid === xuid || remaining.length === 0) {
      await this.dissolve(party.partyId);
      return { ok: true, dissolved: true };
    }
    party.members = remaining;
    party.lastActivity = new Date();
    await party.save();
    this.emitRoster(party);
    return { ok: true, dissolved: false };
  }

  async decline(partyId: string, xuid: string): Promise<{ ok: true }> {
    await this.invites.deleteOne({ partyId, targetXuid: xuid });
    return { ok: true };
  }

  // The push-via-poll: returns the caller's current party (with the full roster) +
  // their pending invites, and doubles as the caller's liveness heartbeat.
  async poll(xuid: string): Promise<PollResponse> {
    let party: PartyDocument | null = await this.parties.findOne({
      'members.xuid': xuid,
    });
    if (party) {
      party = await this.stampAndReap(party, xuid);
    }
    const invites = await this.invites.find({ targetXuid: xuid });
    return {
      party: party ? this.toResponse(party) : null,
      invites: invites.map((i) => ({
        partyId: i.partyId,
        fromXuid: i.fromXuid,
        fromGamertag: i.fromGamertag,
      })),
    };
  }

  // --- helpers ---

  // Enrich a member from its login record (gamertag + console MAC == peer_key).
  private async memberFor(xuid: string): Promise<PartyMember> {
    const player = await this.players.findByXuid(new Xuid(xuid));
    if (!player || !player.macAddress) {
      throw new ConflictException({
        error: 'relogin_required',
        message: `no login record for ${xuid}; the console must (re)register`,
      });
    }
    return {
      xuid,
      gamertag: player.gamertag ? player.gamertag.value : xuid,
      peerKey: player.macAddress.value,
      lastPoll: new Date(),
    };
  }

  private async requireParty(partyId: string): Promise<PartyDocument> {
    const party = await this.parties.findOne({ partyId });
    if (!party) {
      throw new NotFoundException({
        error: 'party_not_found',
        message: `party ${partyId} does not exist`,
      });
    }
    return party;
  }

  // Stamp the caller's liveness, drop members idle > MEMBER_REAP_MS, and dissolve
  // the party if that leaves it empty or ownerless. Returns null when dissolved.
  private async stampAndReap(
    party: PartyDocument,
    callerXuid: string,
  ): Promise<PartyDocument | null> {
    const now = Date.now();
    const before = party.members.length;
    for (const m of party.members) {
      if (m.xuid === callerXuid) m.lastPoll = new Date(now);
    }
    party.members = reapStaleMembers(party.members, now);
    if (shouldDissolve(party.members, party.ownerXuid)) {
      await this.dissolve(party.partyId);
      return null;
    }
    party.lastActivity = new Date(now);
    await party.save();
    if (party.members.length !== before) this.emitRoster(party); // a member was reaped
    return party;
  }

  private async dissolve(partyId: string): Promise<void> {
    const party = await this.parties.findOne({ partyId });
    const memberXuids = party ? party.members.map((m) => m.xuid) : [];
    await this.parties.deleteOne({ partyId });
    await this.invites.deleteMany({ partyId });
    if (memberXuids.length) {
      this.events.pushMany(memberXuids, {
        type: 'party.dissolved',
        payload: { partyId },
      });
    }
  }

  // Push the current roster to every member (party.roster event).
  private emitRoster(party: PartyDocument): void {
    const roster = this.toResponse(party);
    this.events.pushMany(
      roster.members.map((m) => m.xuid),
      { type: 'party.roster', payload: roster },
    );
  }

  private async touch(party: PartyDocument): Promise<void> {
    party.lastActivity = new Date();
    await party.save();
  }

  private toResponse(party: PartyDocument): PartyResponse {
    return {
      partyId: party.partyId,
      ownerXuid: party.ownerXuid,
      members: party.members.map((m) => ({
        xuid: m.xuid,
        gamertag: m.gamertag,
        peer_key: m.peerKey,
      })),
    };
  }
}
