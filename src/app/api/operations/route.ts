import { z } from 'zod';
import { tenant } from '@/lib/auth';
import { body, failure } from '@/lib/http';
import { operationsService } from '@/adapters/operations/prisma-store';
export async function GET(request:Request){try{const context=await tenant(request);const id=z.string().min(1).max(128).parse(new URL(request.url).searchParams.get('businessId'));return Response.json(await operationsService.list(id,context),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const context=await tenant(request);const input=z.object({businessId:z.string().min(1).max(128),command:z.unknown()}).parse(await body(request));return Response.json(await operationsService.execute(input.businessId,context,input.command));}catch(error){return failure(error);}}
