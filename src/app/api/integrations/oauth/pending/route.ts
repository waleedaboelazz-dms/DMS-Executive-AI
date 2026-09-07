import { z } from 'zod';
import { tenant } from '@/lib/auth';
import { failure, HttpError } from '@/lib/http';
import { db } from '@/lib/db';
import { oauthHash } from '@/adapters/integrations/oauth';
export async function GET(request: Request) { try {
  const context = await tenant(request);
  const state = z.string().min(1).max(256).parse(new URL(request.url).searchParams.get('state'));
  const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: oauthHash(state) } });
  if (!attempt || attempt.userId!==context.userId || !attempt.pendingAccounts || attempt.expiresAt<new Date()) throw new HttpError(404, 'This account selection has expired. Reconnect to try again.');
  return Response.json({ provider: attempt.provider, accounts: attempt.pendingAccounts });
} catch(e) { return failure(e); } }
