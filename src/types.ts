import type { D1Database } from '@cloudflare/workers-types';
import type { User } from './auth.js';

type RateLimit = { limit(o: { key: string }): Promise<{ success: boolean }> };
export type Bindings = { DB: D1Database; RL_AUTH?: RateLimit; RL_WEB?: RateLimit; RL_API?: RateLimit };
export type AppEnv = { Bindings: Bindings; Variables: { user: User | null; api: { userId: string; keyId: string } } };
