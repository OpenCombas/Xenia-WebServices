import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';

export interface ServerEvent {
  type: string;
  payload?: unknown;
}

// The connection registry + push API for the live-events WebSocket. Presence is
// derived from this: a console is online iff it has a live socket here. Kept free of
// party/friends deps so both those services and the gateway can share one instance.
@Injectable()
export class EventsService {
  // XUID -> its live sockets (a console may briefly hold >1 across a reconnect).
  private readonly sockets = new Map<string, Set<WebSocket>>();

  register(xuid: string, socket: WebSocket): void {
    let set = this.sockets.get(xuid);
    if (!set) {
      set = new Set();
      this.sockets.set(xuid, set);
    }
    set.add(socket);
  }

  // Returns true if this was the LAST socket for the xuid — i.e. it just went offline.
  unregister(xuid: string, socket: WebSocket): boolean {
    const set = this.sockets.get(xuid);
    if (!set) return false;
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(xuid);
      return true;
    }
    return false;
  }

  // Online iff the xuid has at least one OPEN socket. Critically this checks readyState, not just map
  // presence: a socket that closed uncleanly (Xenia crash / half-open TCP) or is mid-close lingers in the
  // set until unregister/heartbeat runs, and counting it would report stale "online" presence. Any
  // non-OPEN socket found here is pruned on the spot, so presence self-heals on the next read instead of
  // waiting for the ~30s heartbeat.
  isOnline(xuid: string): boolean {
    const set = this.sockets.get(xuid);
    if (!set) return false;
    for (const s of set) {
      if (s.readyState !== WebSocket.OPEN) set.delete(s);
    }
    if (set.size === 0) {
      this.sockets.delete(xuid);
      return false;
    }
    return true;
  }

  push(xuid: string, event: ServerEvent): void {
    this.pushMany([xuid], event);
  }

  pushMany(xuids: Iterable<string>, event: ServerEvent): void {
    const msg = JSON.stringify(event);
    for (const xuid of xuids) {
      const set = this.sockets.get(xuid);
      if (!set) continue;
      for (const s of set) {
        if (s.readyState === WebSocket.OPEN) s.send(msg);
      }
    }
  }
}
