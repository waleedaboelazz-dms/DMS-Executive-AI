import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { tenant } from '@/lib/auth';
import { body, failure, HttpError } from '@/lib/http';
import { db } from '@/lib/db';
import { decryptCredential } from '@/lib/crypto';
import { oauthHash } from '@/adapters/integrations/oauth';
import { integrationService } from '@/adapters/integrations/runtime';
import { providerSchema, connectionSchema, accountIdPattern } from '@/modules/integrations/types';
export async function POST(request: Request) { try {
  const context = await tenant(request);
  const input = z.object({ state: z.string().min(1).max(256), accountId: z.string().regex(accountIdPattern) }).parse(await body(request));
  const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: oauthHash(input.state) } });
  if (!attempt || attempt.userId!==context.userId || !attempt.pendingCredentialsEncrypted || !attempt.pendingAccounts || attempt.expiresAt<new Date()) throw new HttpError(404, 'This account selection has expired. Reconnect to try again.');
  const accounts = z.array(z.object({ id: z.string(), name: z.string() })).parse(attempt.pendingAccounts);
  if (!accounts.some(a => a.id===input.accountId)) throw new HttpError(422, 'That account was not offered by this authorization. Reconnect to try again.');
  const membership = await db.membership.findUnique({ where: { userId_organizationId: { userId: attempt.userId, organizationId: attempt.organizationId } } });
  if (!membership || !['owner','admin'].includes(membership.role)) throw new HttpError(403, 'Only an owner or admin can complete this connection');
  const provider = providerSchema.parse(attempt.provider);
  const credentials = connectionSchema.parse({ ...JSON.parse(decryptCredential(attempt.pendingCredentialsEncrypted)), accountId: input.accountId });
  await integrationService.connect(attempt.businessId, { userId: membership.userId, organizationId: membership.organizationId, role: membership.role }, provider, credentials);
  await db.oAuthAttempt.update({ where: { stateHash: attempt.stateHash }, data: { pendingCredentialsEncrypted: null, pendingAccounts: Prisma.DbNull, expiresAt: new Date() } });
  return Response.json({ ok: true });
} catch(e) { return failure(e); } }
