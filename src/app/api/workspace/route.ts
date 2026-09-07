import { z } from 'zod';
import { identity, tenant } from '@/lib/auth';
import { body, failure } from '@/lib/http';
import { businessRepository } from '@/adapters/prisma';
import { BusinessService } from '@/modules/businesses/service';
const service=new BusinessService(businessRepository);
export async function GET(request: Request) { try { const context = await tenant(request); return Response.json({ businesses: await service.list(context), role: context.role }); } catch(e) { return failure(e); } }
export async function POST(request: Request) { try {
  const input = z.object({ name: z.string().trim().min(2).max(80), provision: z.boolean().default(false) }).parse(await body(request));
  if (input.provision) return Response.json(await service.provision(await identity(request),input.name),{status:201});
  const context = await tenant(request);
  const business = await service.create(context,input.name);
  return Response.json(business,{status:201});
} catch(e) { return failure(e); } }
