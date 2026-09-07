import { NextRequest,NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encryptCredential,decryptCredential } from '@/lib/crypto';
import { oauthConfig,oauthHash } from '@/adapters/integrations/oauth';
import { integrationService,versions } from '@/adapters/integrations/runtime';
import { ProviderHttp,record,string,number } from '@/modules/integrations/http';
import { providerSchema,connectionSchema,type Credentials } from '@/modules/integrations/types';
import { listAccounts } from '@/modules/integrations/accounts';
// Providers where a single OAuth grant can reach more than one account/property; the user must pick one.
const multiAccount=new Set(['ga4','google-ads','search-console']);
export async function GET(request:NextRequest){
  const origin=new URL(process.env.APP_URL??'http://127.0.0.1:3000').origin;
  let result='failed';
  try{
    const state=request.nextUrl.searchParams.get('state'),code=request.nextUrl.searchParams.get('code'),cookie=request.cookies.get('dms_oauth')?.value;
    if(!state||state.length>256||!code||code.length>4096||!cookie)throw new Error('OAUTH_REJECTED');
    const attempt=await db.oAuthAttempt.findUnique({where:{stateHash:oauthHash(state)}});
    if(!attempt||attempt.cookieHash!==oauthHash(cookie)||attempt.expiresAt<new Date()||attempt.consumedAt)throw new Error('OAUTH_REJECTED');
    const membership=await db.membership.findUnique({where:{userId_organizationId:{userId:attempt.userId,organizationId:attempt.organizationId}}});
    if(!membership||!['owner','admin'].includes(membership.role))throw new Error('OAUTH_REJECTED');
    const claimed=await db.oAuthAttempt.updateMany({where:{stateHash:attempt.stateHash,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});if(claimed.count!==1)throw new Error('OAUTH_REPLAY');
    const provider=providerSchema.parse(attempt.provider),config=oauthConfig(provider);
    const tokens=record(await new ProviderHttp().json(config.tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,client_id:config.clientId,client_secret:config.clientSecret,...(attempt.verifierEncrypted?{code_verifier:decryptCredential(attempt.verifierEncrypted)}:{})}).toString()},false));
    const credentials:Credentials=connectionSchema.parse({accessToken:string(tokens.access_token),refreshToken:typeof tokens.refresh_token==='string'?tokens.refresh_token:undefined,expiresAt:new Date(Date.now()+number(tokens.expires_in)*1000).toISOString(),accountId:attempt.accountId??undefined,...(provider==='google-ads'?{developerToken:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,loginCustomerId:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}:{})});
    const tenantContext={userId:membership.userId,organizationId:membership.organizationId,role:membership.role};
    if(!attempt.accountId&&multiAccount.has(provider)){
      // Discover which accounts/properties this grant can reach instead of requiring the user to already know the numeric ID.
      const accounts=await listAccounts(provider,credentials,versions().googleAds);
      if(accounts.length===0)throw new Error('NO_ACCOUNTS_FOUND');
      if(accounts.length===1){await integrationService.connect(attempt.businessId,tenantContext,provider,{...credentials,accountId:accounts[0].id});result='connected';}
      else{await db.oAuthAttempt.update({where:{stateHash:attempt.stateHash},data:{pendingCredentialsEncrypted:encryptCredential(JSON.stringify(credentials)),pendingAccounts:accounts,expiresAt:new Date(Date.now()+10*60000)}});
        const response=NextResponse.redirect(origin+'/?integration_result=select_account&provider='+provider+'&state='+encodeURIComponent(state));response.cookies.delete({name:'dms_oauth',path:'/api/integrations/oauth'});return response;}
    }else{await integrationService.connect(attempt.businessId,tenantContext,provider,credentials);result='connected';}
  }catch{console.error(JSON.stringify({event:'oauth_callback_rejected'}));}
  const response=NextResponse.redirect(origin+'/?integration_result='+result);response.cookies.delete({name:'dms_oauth',path:'/api/integrations/oauth'});return response;
}
