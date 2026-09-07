import { z } from 'zod';
import { tenant } from '@/lib/auth';
import { body,failure,HttpError } from '@/lib/http';
import { db } from '@/lib/db';
import { integrationAccess,integrationList,sourceSummaries } from '@/adapters/integrations/prisma-store';
import { integrationService } from '@/adapters/integrations/runtime';
import { connectionSchema,providerSchema,rangeSchema } from '@/modules/integrations/types';
export async function GET(request:Request){try{const context=await tenant(request),businessId=z.string().min(1).parse(new URL(request.url).searchParams.get('businessId'));return Response.json({integrations:await integrationList(businessId,context),summaries:await sourceSummaries(businessId,context),canManage:['owner','admin'].includes(context.role),oauth:{salla:process.env.SALLA_CUSTOM_OAUTH_ENABLED==='true'&&!!process.env.SALLA_CLIENT_ID,ga4:!!process.env.GOOGLE_CLIENT_ID,'google-ads':!!process.env.GOOGLE_CLIENT_ID},workerConfigured:!!process.env.REDIS_URL},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
  const context=await tenant(request);const input=z.discriminatedUnion('action',[
    z.object({action:z.literal('connect'),businessId:z.string().min(1),provider:providerSchema,credentials:connectionSchema}),
    z.object({action:z.literal('disconnect'),businessId:z.string().min(1),provider:providerSchema}),
    z.object({action:z.literal('sync'),businessId:z.string().min(1),provider:providerSchema,range:rangeSchema}),
    z.object({action:z.literal('schedule'),businessId:z.string().min(1),provider:providerSchema,enabled:z.boolean()}),
  ]).parse(await body(request));
  await integrationAccess(input.businessId,context);
  // Owner-level API throttling applies before any credential verification/provider request.
  const key=`integration:${context.userId}:${Math.floor(Date.now()/60000)}`,limit=await db.rateLimit.upsert({where:{key},create:{key,expiresAt:new Date(Date.now()+120000)},update:{count:{increment:1}}});if(limit.count>15)throw new HttpError(429,'Too many integration requests. Retry in one minute.');
  if(input.action==='connect')await integrationService.connect(input.businessId,context,input.provider,input.credentials);
  if(input.action==='disconnect')await integrationService.disconnect(input.businessId,context,input.provider);
  if(input.action==='sync')return Response.json(await integrationService.sync(input.businessId,context,input.provider,input.range),{status:202});
  if(input.action==='schedule'){const result=await db.integration.updateMany({where:{businessId:input.businessId,provider:input.provider,status:'connected'},data:{autoSync:input.enabled}});if(!result.count)throw new HttpError(409,'Connect this provider first');await db.auditLog.create({data:{businessId:input.businessId,userId:context.userId,action:'integration.schedule',reason:input.provider,result:input.enabled?'hourly-enabled':'disabled'}});}
  return Response.json({ok:true});
}catch(e){return failure(e);}}
