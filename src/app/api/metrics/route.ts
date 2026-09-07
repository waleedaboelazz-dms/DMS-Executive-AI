import { z } from 'zod';
import { tenant } from '@/lib/auth';
import { body, failure } from '@/lib/http';
import { metricsRepository } from '@/adapters/prisma';
import { metricSchema } from '@/modules/metrics/engine';
export async function GET(request: Request) { try { const context = await tenant(request); const id = z.string().min(1).parse(new URL(request.url).searchParams.get('businessId')); return Response.json(await metricsRepository.list(id, context)); } catch(e) { return failure(e); } }
export async function POST(request: Request) { try { const context = await tenant(request); const input = z.object({businessId:z.string().min(1),metric:metricSchema}).parse(await body(request)); await metricsRepository.save(input.businessId,context,input.metric); return Response.json({saved:true}); } catch(e) { return failure(e); } }
