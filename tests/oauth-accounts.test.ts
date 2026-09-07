import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderHttp } from '../src/modules/integrations/http';
import { listAccounts } from '../src/modules/integrations/accounts';
const credentials = { accessToken: 'token-abc' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('listAccounts flattens GA4 property summaries across accounts and falls back to a generated name', async () => {
  const http = new ProviderHttp(async (url, init) => {
    assert.equal(new URL(url).hostname, 'analyticsadmin.googleapis.com');
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer token-abc');
    return response({ accountSummaries: [
      { account: 'accounts/1', propertySummaries: [{ property: 'properties/111', displayName: 'iNatural - GA4' }, { property: 'properties/222' }] },
      { account: 'accounts/2', propertySummaries: [{ property: 'properties/333', displayName: 'DMS Studio' }] },
    ] });
  });
  const accounts = await listAccounts('ga4', credentials, 'v18', http);
  assert.deepEqual(accounts, [
    { id: '111', name: 'iNatural - GA4' },
    { id: '222', name: 'Property 222' },
    { id: '333', name: 'DMS Studio' },
  ]);
});

test('listAccounts requires a developer token for Google Ads and sends it as a header', async () => {
  const originalToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  try {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    await assert.rejects(() => listAccounts('google-ads', credentials, 'v18'), /CONFIGURATION/);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token-xyz';
    const http = new ProviderHttp(async (url, init) => {
      assert.equal(url, 'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers');
      assert.equal((init?.headers as Record<string,string>)['developer-token'], 'dev-token-xyz');
      return response({ resourceNames: ['customers/1112223333', 'customers/4445556666'] });
    });
    const accounts = await listAccounts('google-ads', credentials, 'v18', http);
    assert.deepEqual(accounts, [{ id: '1112223333', name: 'Google Ads · 1112223333' }, { id: '4445556666', name: 'Google Ads · 4445556666' }]);
  } finally { if (originalToken===undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN; else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = originalToken; }
});

test('listAccounts rejects providers with no account-discovery capability', async () => {
  await assert.rejects(() => listAccounts('salla', credentials, 'v18'), /NOT_SUPPORTED/);
  await assert.rejects(() => listAccounts('meta', credentials, 'v18'), /NOT_SUPPORTED/);
});

test('listAccounts lists verified Search Console sites by URL and excludes unverified ones', async () => {
  const http = new ProviderHttp(async url => {
    assert.equal(url, 'https://www.googleapis.com/webmasters/v3/sites');
    return response({ siteEntry: [
      { siteUrl: 'https://inatural.sa/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:inatural.sa', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://not-mine.example/', permissionLevel: 'siteUnverifiedUser' },
    ] });
  });
  const accounts = await listAccounts('search-console', credentials, 'v18', http);
  assert.deepEqual(accounts, [{ id: 'https://inatural.sa/', name: 'https://inatural.sa/' }, { id: 'sc-domain:inatural.sa', name: 'sc-domain:inatural.sa' }]);
});
