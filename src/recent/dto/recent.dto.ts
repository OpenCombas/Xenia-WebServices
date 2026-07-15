// GET /recent?xuid=&limit= -> { recent: RecentPlayer[] } (newest first). presence `online` is folded
// in from the live-events WS connection (same liveness signal as /friends), so it is never stale.
export interface RecentPlayer {
  xuid: string;
  gamertag: string;
  lastSeen: string; // ISO-8601
  encounterCount: number;
  online: boolean;
}

export interface RecentResponse {
  recent: RecentPlayer[];
}

// POST /recent/remove — drop a single entry (mirrors /friends/remove; the client's HTTP layer can't
// send a body on DELETE).
export class RecentRemoveRequest {
  xuid: string;
  otherXuid: string;
}

// POST /recent/clear — wipe the caller's whole recent list.
export class RecentClearRequest {
  xuid: string;
}
