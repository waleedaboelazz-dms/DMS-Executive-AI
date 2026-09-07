import { z } from 'zod';
import { tenant, requireBusiness, requireWrite, aiLimit } from '@/lib/auth';
import { failure, HttpError } from '@/lib/http';
import { metricsRepository, reportRepository } from '@/adapters/prisma';
import { OpenAiProvider } from '@/adapters/openai';
import { ExecutiveAgent } from '@/modules/ai/executive';
import { sourceSummaries, integrationList, listProducts, customerSummary } from '@/adapters/integrations/prisma-store';
export async function GET(request: Request) { try {
  const context = await tenant(request); requireWrite(context);
  const params = new URL(request.url).searchParams;
  const input = z.object({businessId:z.string().min(1),days:z.union([z.literal(1),z.literal(7),z.literal(30)]).default(7),language:z.enum(['ar','en']).default('en')}).parse({businessId:params.get('businessId'),days:params.get('days')?Number(params.get('days')):undefined,language:params.get('language')??undefined});
  const business = await requireBusiness(input.businessId,context); await aiLimit(context,2);
  const [rows,sources,integrations,products,customers] = await Promise.all([metricsRepository.list(input.businessId,context),sourceSummaries(input.businessId,context),integrationList(input.businessId,context),listProducts(input.businessId,context),customerSummary(input.businessId,context)]);
  if (!rows.length&&!sources.length) throw new HttpError(422,'Add or synchronize business data before requesting an executive brief');
  const dataset = {businessName:business.name,currency:business.currency,metrics:rows,sources,integrations:integrations.map(i=>({provider:i.provider,status:i.status,lastSync:i.lastSync?i.lastSync.toISOString():null})),products:products.map(p=>({name:p.name,sku:p.sku,inventoryQuantity:p.inventoryQuantity,status:p.status})),customerSummary:customers,generatedAt:new Date().toISOString()};
  const brief = await new ExecutiveAgent(new OpenAiProvider()).brief({dataset,days:input.days,language:input.language});
  await reportRepository.save({businessId:input.businessId,tenant:context,title:`${input.language==='ar'?'الملخص التنفيذي':'Executive brief'} · ${input.days}d · ${dataset.generatedAt.slice(0,10)}`,content:brief.summary,context:brief,kind:'ai-brief'});
  return Response.json(brief);
} catch(e) { return failure(e); } }
