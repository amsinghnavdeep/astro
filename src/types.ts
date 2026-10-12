import type { D1Database } from '@cloudflare/workers-types';
import type { User } from './auth.js';

export type Bindings = { DB: D1Database };
export type AppEnv = { Bindings: Bindings; Variables: { user: User | null; api: { userId: string; keyId: string } } };
