import { IntegrationService } from '@/modules/integrations/service';
import { createConnector } from '@/modules/integrations/registry';
import { connectionSchema,ConnectorError,type Credentials,type ProviderId } from '@/modules/integrations/types';
import { ProviderHttp,record,number,string } from '@/modules/integrations/http';
import { integrationStore } from './prisma-store';
import { syncQueue } from './queue';
export const versions=()=>({meta:process.env.META_API_VERSION??'',googleAds:process.env.GOOGLE_ADS_API_VERSION??'v24'});
export async function refreshCredentials(provider:ProviderId,credentials:Credentials):Promise<Credentials>{
  if(!credentials.expiresAt||Date.parse(credentials.expiresAt)>Date.now()+120000)return credentials;
  if(!credentials.refreshToken)throw new ConnectorError('AUTH_EXPIRED');
  const prefix=provider==='salla'?'SALLA':provider==='zid'?'ZID':provider==='ga4'||provider==='google-ads'||provider==='search-console'?'GOOGLE':null;
  if(!prefix)throw new ConnectorError('AUTH_EXPIRED');
  const clientId=process.env[prefix+'_CLIENT_ID'],clientSecret=process.env[prefix+'_CLIENT_SECRET'];
  if(!clientId||!clientSecret)throw new ConnectorError('CONFIGURATION');
  const url=prefix==='SALLA'?'https://accounts.salla.sa/oauth2/token':prefix==='ZID'?'https://oauth.zid.sa/oauth/token':'https://oauth2.googleapis.com/token';
  const data=record(await new ProviderHttp().json(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refreshToken,client_id:clientId,client_secret:clientSecret}).toString()},false));
  return connectionSchema.parse({...credentials,accessToken:string(data.access_token),refreshToken:typeof data.refresh_token==='string'?data.refresh_token:credentials.refreshToken,expiresAt:new Date(Date.now()+number(data.expires_in)*1000).toISOString(),...(provider==='zid'&&typeof data.authorization==='string'?{authorizationToken:data.authorization}:{})});
}
export const integrationService=new IntegrationService(integrationStore,(provider,credentials)=>createConnector(provider,credentials,versions()),syncQueue,refreshCredentials);
