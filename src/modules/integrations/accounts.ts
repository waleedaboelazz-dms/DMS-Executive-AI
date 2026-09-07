import { ConnectorError, type Credentials, type ProviderId } from './types';
import { ProviderHttp, endpoint, record, list, string } from './http';

// Post-consent account discovery: lets a user pick which Google Analytics property or Google Ads
// customer to attach, instead of requiring them to already know its numeric ID before OAuth starts.
export type DiscoveredAccount = { id: string; name: string };

export async function listAccounts(provider: ProviderId, credentials: Credentials, googleAdsVersion: string, http = new ProviderHttp()): Promise<DiscoveredAccount[]> {
  const headers = { Authorization: `Bearer ${credentials.accessToken}` };
  if (provider === 'ga4') {
    const url = endpoint('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', { pageSize: '200' });
    const data = record(await http.json(url, { headers }));
    const summaries = list(data.accountSummaries ?? []);
    const accounts: DiscoveredAccount[] = [];
    for (const raw of summaries) {
      const summary = record(raw);
      for (const rawProperty of list(summary.propertySummaries ?? [])) {
        const property = record(rawProperty);
        const id = string(property.property).replace('properties/', '');
        accounts.push({ id, name: typeof property.displayName === 'string' && property.displayName ? property.displayName : `Property ${id}` });
      }
    }
    return accounts;
  }
  if (provider === 'google-ads') {
    const url = `https://googleads.googleapis.com/${googleAdsVersion}/customers:listAccessibleCustomers`;
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!devToken) throw new ConnectorError('CONFIGURATION');
    const data = record(await http.json(url, { headers: { ...headers, 'developer-token': devToken } }));
    // Google Ads does not return descriptive names here without an extra per-customer query; show the ID.
    return list(data.resourceNames ?? []).map(raw => { const id = string(raw).replace('customers/', ''); return { id, name: `Google Ads · ${id}` }; });
  }
  if (provider === 'search-console') {
    const data = record(await http.json('https://www.googleapis.com/webmasters/v3/sites', { headers }));
    // Sites are identified by their URL (or "sc-domain:example.com" for domain properties), not a numeric ID.
    return list(data.siteEntry ?? []).filter(raw => { const s = record(raw); return s.permissionLevel !== 'siteUnverifiedUser'; }).map(raw => { const id = string(record(raw).siteUrl); return { id, name: id }; });
  }
  throw new ConnectorError('NOT_SUPPORTED');
}
