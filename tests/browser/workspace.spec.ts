import { test, expect } from '@playwright/test';
test('demo dashboard, real calculations, persistence, reports and RTL',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Good afternoon, Waleed.'})).toBeVisible();
  await page.getByRole('button',{name:'Add data',exact:true}).click();
  await page.locator('input[name="date"]').fill('2026-09-07');
  for(const [name,value] of Object.entries({revenue:'1000',orders:'10',adSpend:'200',cogs:'300',expenses:'100',leads:'4',sessions:'200'}))await page.locator(`input[name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'Save and recalculate'}).click();await page.getByRole('button',{name:'Latest day',exact:true}).click();
  await expect(page.locator('.kpi-card').first()).toContainText('1,000');await expect(page.locator('.kpi-card').last()).toContainText('400');
  await page.reload();await page.getByRole('button',{name:'Latest day',exact:true}).click();await expect(page.locator('.kpi-card').first()).toContainText('1,000');
  await page.getByRole('button',{name:'Generate report',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Estimated net profit: SAR 400');await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'العربية',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.getByRole('heading',{name:'مساء الخير، وليد.'})).toBeVisible();
  await page.getByRole('button',{name:'Toggle theme'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);await expect(page.locator('.health-card')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('integration setup is honest, business data isolated and mobile has no overflow',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Integrations',exact:true}).click();await page.getByRole('button',{name:'View setup'}).first().click();await expect(page.getByLabel('Connection setup',{exact:true})).toContainText('No credentials are collected');await expect(page.locator('input[name="accessToken"]')).toHaveCount(0);await page.getByRole('button',{name:'Close setup'}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();const first=await page.locator('.kpi-value').first().textContent();await page.getByLabel('Business',{exact:true}).selectOption('demo-dms');await expect(page.locator('.kpi-value').first()).not.toHaveText(first!);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('button',{name:'AI Executive AI',exact:true}).click();await page.getByRole('button',{name:'How is my business doing?'}).click();await expect(page.locator('.chat-message.assistant')).toContainText('demo data');
});
test('production APIs reject unauthenticated data and AI access',async({request})=>{
  for(const path of ['workspace','metrics?businessId=other-tenant','reports?businessId=other-tenant','integrations?businessId=other-tenant'])expect((await request.get('/api/'+path)).status()).toBe(401);
  for(const path of ['metrics','chat','reports','integrations','integrations/oauth'])expect((await request.post('/api/'+path,{data:{businessId:'other'}})).status()).toBe(401);
});
