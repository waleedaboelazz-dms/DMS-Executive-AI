import { z } from 'zod';
import { tenant } from '@/lib/auth';
import { body,failure,HttpError } from '@/lib/http';
import { intelligenceStore,intelligenceHistory } from '@/adapters/intelligence/prisma-store';
import { IntelligenceService } from '@/modules/intelligence/service';
import { OpenAiProvider } from '@/adapters/openai';
export const maxDuration=180;
const options=z.object({businessId:z.string().min(1).max(128),days:z.union([z.literal(1),z.literal(7),z.literal(30)]).default(30),horizon:z.union([z.literal(7),z.literal(30)]).default(7)});
export async function GET(request:Request){try{
  const context=await tenant(request),query=new URL(request.url).searchParams;
  const input=options.parse({businessId:query.get('businessId'),days:Number(query.get('days')??30),horizon:Number(query.get('horizon')??7)});
  const [snapshot,history]=await Promise.all([intelligenceStore.snapshot(input.businessId,context,input),intelligenceHistory(input.businessId,context)]);
  return Response.json({snapshot,history,aiConfigured:Boolean(process.env.OPENAI_API_KEY&&process.env.OPENAI_MODEL),canWrite:['owner','admin','member'].includes(context.role)},{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
  const context=await tenant(request),input=options.extend({language:z.enum(['ar','en'])}).parse(await body(request));
  if(!process.env.OPENAI_API_KEY||!process.env.OPENAI_MODEL)throw new HttpError(503,'Configure OPENAI_API_KEY and OPENAI_MODEL to enable specialist reviews.');
  return Response.json(await new IntelligenceService(intelligenceStore,new OpenAiProvider()).review(input.businessId,context,input,input.language));
}catch(error){return failure(error);}}
