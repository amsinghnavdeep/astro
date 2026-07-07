import { env } from './env';

export function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return match[1] === env.adminApiToken;
}
