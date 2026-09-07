import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { tenant } from '@/lib/auth';
import { db } from '@/lib/db';
import { encryptCredential } from '@/lib/crypto';
import { body,failure } from '@/lib/http';
import { integrationAccess } from '@/adapters/integrations/prisma-store';
import { oauthConfig,oauthHash,oauthSecret } from '@/adapters/integrations/oauth';
import { accountIdPattern } from '@/modules/integrations/types';
export async function POST(request:Request){try{const context=await tenant(request),input=z.object({businessId:z.string().min(1),provider:z.enum(['salla','ga4','google-ads','search-console']),accountId:z.string().regex(accountIdPattern).optional()}).parse(await body(request));await integrationAccess(input.businessId,context);
  const config=oauthConfig(input.provider),state=oauthSecret(),cookie=oauthSecret(),verifier=config.google?oauthSecret():null;
  await db.oAuthAttempt.create({data:{stateHash:oauthHash(state),cookieHash:oauthHash(cookie),userId:context.userId,organizationId:context.organizationId,businessId:input.businessId,provider:input.provider,accountId:input.accountId,expiresAt:new Date(Date.now()+10*60000),verifierEncrypted:verifier?encryptCredential(verifier):null}});
  const url=new URL(config.authUrl);Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:config.scope,state,...(config.google?{access_type:'offline',prompt:'consent',code_challenge:createHash('sha256').update(verifier!).digest('base64url'),code_challenge_method:'S256'}:{})}).forEach(([k,v])=>url.searchParams.set(k,v));
  const response=NextResponse.json({url:url.toString()});response.cookies.set('dms_oauth',cookie,{httpOnly:true,secure:config.origin.startsWith('https:'),sameSite:'lax',maxAge:600,path:'/api/integrations/oauth'});return response;
}catch(e){return failure(e);}}
