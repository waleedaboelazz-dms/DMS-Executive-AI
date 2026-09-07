import { createHash,randomBytes } from 'node:crypto';
import { ConnectorError,type ProviderId } from '@/modules/integrations/types';
export const oauthHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const oauthSecret=()=>randomBytes(32).toString('base64url');
export function oauthConfig(provider:ProviderId){
  const google=provider==='ga4'||provider==='google-ads'||provider==='search-console';if(!google&&provider!=='salla')throw new ConnectorError('NOT_SUPPORTED');
  if(provider==='salla'&&process.env.SALLA_CUSTOM_OAUTH_ENABLED!=='true')throw new ConnectorError('CONFIGURATION');
  const origin=new URL(process.env.APP_URL??'http://127.0.0.1:3000');if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw new ConnectorError('CONFIGURATION');
  const prefix=google?'GOOGLE':'SALLA',clientId=process.env[prefix+'_CLIENT_ID'],clientSecret=process.env[prefix+'_CLIENT_SECRET'];if(!clientId||!clientSecret)throw new ConnectorError('CONFIGURATION');
  const scope=provider==='ga4'?'https://www.googleapis.com/auth/analytics.readonly':provider==='google-ads'?'https://www.googleapis.com/auth/adwords':provider==='search-console'?'https://www.googleapis.com/auth/webmasters.readonly':'orders.read offline_access';
  return{google,origin:origin.origin,redirectUri:origin.origin+'/api/integrations/oauth/callback',clientId,clientSecret,authUrl:google?'https://accounts.google.com/o/oauth2/v2/auth':'https://accounts.salla.sa/oauth2/auth',tokenUrl:google?'https://oauth2.googleapis.com/token':'https://accounts.salla.sa/oauth2/token',scope};
}
