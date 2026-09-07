import { z } from 'zod';
import { tenant, requireBusiness, requireWrite, aiLimit } from '@/lib/auth';
import { body, failure, HttpError } from '@/lib/http';
import { metricsRepository, reportRepository } from '@/adapters/prisma';
import { OpenAiProvider } from '@/adapters/openai';
import { ExecutiveAgent } from '@/modules/ai/executive';
import { ReportService } from '@/modules/reports/service';
import { db } from '@/lib/db';
import { sourceSummaries } from '@/adapters/integrations/prisma-store';
export async function GET(request: Request) { try { const context = await tenant(request); const id = z.string().min(1).parse(new URL(request.url).searchParams.get('businessId')); await requireBusiness(id,context); return Response.json(await db.report.findMany({where:{businessId:id},orderBy:{createdAt:'desc'},take:50})); } catch(e) { return failure(e); } }
export async function POST(request: Request) { try {
  const context = await tenant(request); requireWrite(context);
  const input = z.object({businessId:z.string().min(1),days:z.union([z.literal(1),z.literal(7),z.literal(30)]),language:z.enum(['ar','en']),ai:z.boolean().default(false)}).parse(await body(request));
  const rows = await metricsRepository.list(input.businessId,context),sources=await sourceSummaries(input.businessId,context); if (!rows.length&&!sources.length) throw new HttpError(422,'Add or synchronize data before creating a report');
  if (input.ai) await aiLimit(context);
  return Response.json(await new ReportService(reportRepository,new ExecutiveAgent(new OpenAiProvider())).create({...input,rows,sources,tenant:context}),{status:201});
} catch(e) { return failure(e); } }
