import { EventsService } from './events.service';
import { WebSocket } from 'ws';

// Minimal fake ws socket: reports OPEN and records what was sent.
function fakeSocket() {
  const sent: string[] = [];
  return {
    sent,
    readyState: WebSocket.OPEN as number,
    send: (m: string) => sent.push(m),
  };
}

describe('EventsService', () => {
  it('tracks online status by registered sockets', () => {
    const svc = new EventsService();
    const s = fakeSocket() as unknown as WebSocket;
    expect(svc.isOnline('A')).toBe(false);
    svc.register('A', s);
    expect(svc.isOnline('A')).toBe(true);
    expect(svc.unregister('A', s)).toBe(true); // last socket -> went offline
    expect(svc.isOnline('A')).toBe(false);
  });

  it('treats a socket that died without a clean unregister as offline (self-prune)', () => {
    const svc = new EventsService();
    const s = fakeSocket();
    svc.register('A', s as unknown as WebSocket);
    expect(svc.isOnline('A')).toBe(true);
    // Xenia crashes / half-open TCP: the socket closes but no `close` event ran unregister.
    s.readyState = WebSocket.CLOSED;
    expect(svc.isOnline('A')).toBe(false); // pruned on the next read, not left stale-online
  });

  it('stays online while another socket remains (reconnect race)', () => {
    const svc = new EventsService();
    const s1 = fakeSocket() as unknown as WebSocket;
    const s2 = fakeSocket() as unknown as WebSocket;
    svc.register('A', s1);
    svc.register('A', s2);
    expect(svc.unregister('A', s1)).toBe(false); // s2 remains
    expect(svc.isOnline('A')).toBe(true);
  });

  it('pushes only to the target xuid, and only to open sockets', () => {
    const svc = new EventsService();
    const a = fakeSocket();
    const b = fakeSocket();
    svc.register('A', a as unknown as WebSocket);
    svc.register('B', b as unknown as WebSocket);
    svc.push('A', { type: 'x', payload: { n: 1 } });
    expect(a.sent).toEqual([JSON.stringify({ type: 'x', payload: { n: 1 } })]);
    expect(b.sent).toEqual([]);
  });
});
