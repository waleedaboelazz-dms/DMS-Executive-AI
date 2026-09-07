import { z } from 'zod';
import { tenant, requireBusiness, requireWrite, aiLimit } from '@/lib/auth';
import { body, failure, HttpError } from '@/lib/http';
import { metricsRepository } from '@/adapters/prisma';
import { OpenAiProvider } from '@/adapters/openai';
import { ExecutiveAgent } from '@/modules/ai/executive';
import { db } from '@/lib/db';
import { sourceSummaries, integrationList, listProducts, customerSummary } from '@/adapters/integrations/prisma-store';
export async function POST(request: Request) { try {
  const context = await tenant(request); requireWrite(context);
  const input = z.object({businessId:z.string().min(1),question:z.string().trim().min(1).max(2000),days:z.union([z.literal(1),z.literal(7),z.literal(30)]),language:z.enum(['ar','en'])}).parse(await body(request));
  const business = await requireBusiness(input.businessId,context); await aiLimit(context);
  const [rows,sources,integrations,products,customers] = await Promise.all([metricsRepository.list(input.businessId,context),sourceSummaries(input.businessId,context),integrationList(input.businessId,context),listProducts(input.businessId,context),customerSummary(input.businessId,context)]);
  if (!rows.length&&!sources.length) throw new HttpError(422,'Add or synchronize business data before asking AI');
  const history = await db.aiConversation.findMany({where:{businessId:input.businessId,userId:context.userId},orderBy:{createdAt:'desc'},take:6});
  const dataset = {businessName:business.name,currency:business.currency,metrics:rows,sources,integrations:integrations.map(i=>({provider:i.provider,status:i.status,lastSync:i.lastSync?i.lastSync.toISOString():null})),products:products.map(p=>({name:p.name,sku:p.sku,inventoryQuantity:p.inventoryQuantity,status:p.status})),customerSummary:customers,generatedAt:new Date().toISOString()};
  const {answer,toolsUsed} = await new ExecutiveAgent(new OpenAiProvider()).chat({dataset,question:input.question,language:input.language,history:history.reverse().map(h=>({question:h.question,answer:h.answer}))});
  await db.$transaction([db.aiConversation.create({data:{businessId:input.businessId,userId:context.userId,question:input.question,answer}}),db.auditLog.create({data:{businessId:input.businessId,userId:context.userId,action:'ai.respond',reason:'User question',result:'generated'}})]);
  return Response.json({answer,toolsUsed});
} catch(e) { return failure(e); } }
