import type { Request } from 'express';

// bearerToken pulls the token from `Authorization: Bearer <token>`; "" if absent.
export function bearerToken(req: Request): string {
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}
