import { env } from './env';

const REALM = 'Siddh Jyotish Docs';

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Basic realm="${REALM}"`,
    },
  });
}

export function basicAuthGuard(request: Request): Response | null {
  const user = env.docs.authUser;
  const pass = env.docs.authPass;

  if (!user || !pass) {
    return unauthorized('Docs authentication is not configured.');
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) {
    return unauthorized('Authentication required.');
  }

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return unauthorized('Invalid credentials.');
  }

  const colon = decoded.indexOf(':');
  if (colon < 0) {
    return unauthorized('Invalid credentials.');
  }

  const providedUser = decoded.slice(0, colon);
  const providedPass = decoded.slice(colon + 1);
  if (providedUser !== user || providedPass !== pass) {
    return unauthorized('Invalid credentials.');
  }

  return null;
}
