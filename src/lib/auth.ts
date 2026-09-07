import { createClient } from '@supabase/supabase-js';
import { db } from './db';
import { HttpError } from './http';
import type { TenantContext } from '@/modules/platform/contracts';
export async function identity(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to access your workspace');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(503, 'Authentication is not configured');
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const {data, error} = await auth.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session expired. Sign in again.');
  return data.user.id;
}
export async function tenant(request: Request): Promise<TenantContext> {
  const userId = await identity(request);
  const membership = await db.membership.findFirst({ where: { userId }, orderBy: { organizationId: 'asc' } });
  if (!membership) throw new HttpError(403, 'Create your workspace first');
  return { userId, organizationId: membership.organizationId, role: membership.role };
}
export function requireWrite(context: TenantContext) { if (!['owner','admin','member'].includes(context.role)) throw new HttpError(403, 'Read-only workspace membership'); }
export async function requireBusiness(id: string, context: TenantContext) { const business = await db.business.findFirst({ where: { id, organizationId: context.organizationId } }); if (!business) throw new HttpError(404, 'Business not found'); return business; }
export async function aiLimit(context: TenantContext, units=1) {
  if(!Number.isInteger(units)||units<1||units>5)throw new HttpError(400,'Invalid AI budget reservation');
  const bucket = Math.floor(Date.now() / 60_000);
  const row = await db.rateLimit.upsert({ where: { key: `ai:${context.userId}:${bucket}` }, create: { key: `ai:${context.userId}:${bucket}`, count:units, expiresAt: new Date((bucket + 2) * 60_000) }, update: { count: { increment: units } } });
  if (row.count > 10) throw new HttpError(429, 'AI limit reached. Try again in one minute.');
}
