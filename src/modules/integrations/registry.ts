import { CommerceConnector } from './connectors/commerce';
import { AdvertisingConnector } from './connectors/advertising';
import { AnalyticsConnector } from './connectors/analytics';
import { SearchConsoleConnector } from './connectors/search-console';
import type { Credentials,ProviderId,ReadConnector } from './types';
import { ProviderHttp } from './http';
export function createConnector(provider:ProviderId,credentials:Credentials,versions:{meta:string;googleAds:string},http=new ProviderHttp()):ReadConnector{
  if(provider==='salla'||provider==='zid')return new CommerceConnector(provider,credentials,http);
  if(provider==='ga4')return new AnalyticsConnector(credentials,http);
  if(provider==='search-console')return new SearchConsoleConnector(credentials,http);
  return new AdvertisingConnector(provider,credentials,versions,http);
}
