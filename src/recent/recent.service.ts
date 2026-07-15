import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RecentEncounter,
  RecentEncounterDocument,
} from './schemas/recent.schema';
import { IPlayerRepositorySymbol } from 'src/domain/repositories/IPlayerRepository';
import type IPlayerRepository from 'src/domain/repositories/IPlayerRepository';
import Xuid from 'src/domain/value-objects/Xuid';
import { RecentResponse } from './dto/recent.dto';
import { EventsService } from '../events/events.service';

// Hard cap on stored rows per player (the newest N survive); a 30-day TTL prunes the rest.
export const RECENT_CAP = 50;
export const RECENT_DEFAULT_LIMIT = 25;

// --- pure helper (unit-tested; no I/O) ---

// pairsForJoin returns the directed (owner, other) edges to record for a join: every joiner paired
// with every OTHER current member, both directions, each unordered pair emitted once (so a
// joiner<->joiner pair isn't double-counted). Existing<->existing pairs are skipped — they were
// captured when the later of the two joined. Returns [] when there is nothing to pair.
export function pairsForJoin(
  allXuids: string[],
  joinerXuids: string[],
): [string, string][] {
  const all = [...new Set(allXuids.filter(Boolean))];
  const joiners = [...new Set(joinerXuids.filter((j) => all.includes(j)))];
  if (all.length < 2 || joiners.length === 0) return [];

  const seen = new Set<string>();
  const directed: [string, string][] = [];
  for (const j of joiners) {
    for (const m of all) {
      if (m === j) continue;
      const key = j < m ? `${j}|${m}` : `${m}|${j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      directed.push([j, m], [m, j]);
    }
  }
  return directed;
}

@Injectable()
export class RecentService {
  constructor(
    @InjectModel(RecentEncounter.name)
    private readonly recent: Model<RecentEncounterDocument>,
    @Inject(IPlayerRepositorySymbol)
    private readonly players: IPlayerRepository,
    private readonly events: EventsService,
  ) {}

  // captureJoin records the co-membership formed by a session join: each joiner meets every other
  // current member (both directions). Called best-effort from JoinSessionCommandHandler AFTER the join
  // commits, so a failure here never affects the join.
  async captureJoin(allXuids: string[], joinerXuids: string[]): Promise<void> {
    const directed = pairsForJoin(allXuids, joinerXuids);
    if (directed.length === 0) return;

    // Snapshot each "other" party's gamertag once (denormalized — outlives their 1-day Player doc).
    const others = [...new Set(directed.map(([, o]) => o))];
    const tags = await this.gamertags(others);

    const now = new Date();
    await Promise.all(
      directed.map(([owner, other]) =>
        this.recent.updateOne(
          { ownerXuid: owner, otherXuid: other },
          {
            $set: { gamertag: tags.get(other) ?? '', lastSeen: now },
            $inc: { encounterCount: 1 },
          },
          { upsert: true },
        ),
      ),
    );

    // Enforce the last-N cap for each owner whose list just grew.
    const owners = [...new Set(directed.map(([o]) => o))];
    await Promise.all(owners.map((o) => this.trim(o)));
  }

  // list returns the caller's most-recent encounters, newest first, capped. gamertag is re-enriched
  // from the live Player doc when still present, else the stored snapshot; `online` is live WS liveness.
  async list(xuid: string, limit: number): Promise<RecentResponse> {
    const me = new Xuid(xuid).value;
    const cap = Math.min(Math.max(limit || RECENT_DEFAULT_LIMIT, 1), RECENT_CAP);
    const rows = await this.recent
      .find({ ownerXuid: me })
      .sort({ lastSeen: -1 })
      .limit(cap);

    const recent = await Promise.all(
      rows.map(async (r) => ({
        xuid: r.otherXuid,
        gamertag: (await this.liveGamertag(r.otherXuid)) ?? r.gamertag,
        lastSeen: r.lastSeen.toISOString(),
        encounterCount: r.encounterCount,
        online: this.events.isOnline(r.otherXuid),
      })),
    );
    return { recent };
  }

  async remove(xuid: string, otherXuid: string): Promise<{ ok: true }> {
    await this.recent.deleteOne({
      ownerXuid: new Xuid(xuid).value,
      otherXuid: new Xuid(otherXuid).value,
    });
    return { ok: true };
  }

  async clear(xuid: string): Promise<{ ok: true }> {
    await this.recent.deleteMany({ ownerXuid: new Xuid(xuid).value });
    return { ok: true };
  }

  // --- helpers ---

  private async trim(owner: string): Promise<void> {
    const stale = await this.recent
      .find({ ownerXuid: owner })
      .sort({ lastSeen: -1 })
      .skip(RECENT_CAP)
      .select('_id');
    if (stale.length > 0) {
      await this.recent.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    }
  }

  private async gamertags(xuids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (xuids.length === 0) return map;
    const players = await this.players.findByXuids(xuids.map((x) => new Xuid(x)));
    for (const p of players ?? []) {
      map.set(p.xuid.value, p.gamertag ? p.gamertag.value : '');
    }
    return map;
  }

  private async liveGamertag(xuid: string): Promise<string | undefined> {
    const p = await this.players.findByXuid(new Xuid(xuid));
    return p && p.gamertag ? p.gamertag.value : undefined;
  }
}
