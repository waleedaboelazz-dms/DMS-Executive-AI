import { ConnectorError,rangeSchema,sourceMetricSchema,type Credentials,type DateRange,type ReadConnector,type SyncResult } from '../types';
import { ProviderHttp,endpoint,record,list,number,string } from '../http';
export class AdvertisingConnector implements ReadConnector {
  constructor(readonly provider:'meta'|'tiktok'|'google-ads',private credentials:Credentials,private versions:{meta:string;googleAds:string},private http=new ProviderHttp()){
    if(!credentials.accountId||(provider==='google-ads'&&!credentials.developerToken))throw new ConnectorError('CONFIGURATION');
    if((provider==='meta'&&!/^v\d+\.0$/.test(versions.meta))||(provider==='google-ads'&&!/^v\d+$/.test(versions.googleAds)))throw new ConnectorError('CONFIGURATION');
  }
  private headers():Record<string,string>{return this.provider==='tiktok'?{'Access-Token':this.credentials.accessToken}:{Authorization:`Bearer ${this.credentials.accessToken}`,...(this.provider==='google-ads'?{'developer-token':this.credentials.developerToken!,'Content-Type':'application/json',...(this.credentials.loginCustomerId?{'login-customer-id':this.credentials.loginCustomerId}:{})}:{})};}
  private async google(query:string,pageToken?:string){return record(await this.http.json(`https://googleads.googleapis.com/${this.versions.googleAds}/customers/${this.credentials.accountId}/googleAds:search`,{method:'POST',headers:this.headers(),body:JSON.stringify({query,...(pageToken?{pageToken}:{})})}));}
  private async account():Promise<{currency:string;timezone:string}>{
    if(this.provider==='meta'){const data=record(await this.http.json(endpoint(`https://graph.facebook.com/${this.versions.meta}/act_${this.credentials.accountId}`,{fields:'id,currency,timezone_name'}),{headers:this.headers()}));return{currency:string(data.currency),timezone:string(data.timezone_name)};}
    if(this.provider==='google-ads'){const data=await this.google('SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1');const customer=record(record(list(data.results)[0]).customer);return{currency:string(customer.currencyCode),timezone:string(customer.timeZone)};}
    const data=record(await this.http.json(endpoint('https://business-api.tiktok.com/open_api/v1.3/advertiser/info/',{advertiser_ids:JSON.stringify([this.credentials.accountId]),fields:JSON.stringify(['currency','timezone'])}),{headers:this.headers()}));this.checkTikTok(data);const account=record(list(record(data.data).list)[0]);return{currency:string(account.currency),timezone:string(account.timezone)};
  }
  private checkTikTok(data:Record<string,unknown>){if(data.code!==0)throw new ConnectorError(data.code===40100?'AUTH_EXPIRED':data.code===40102?'RATE_LIMITED':'INVALID_RESPONSE',data.code===40102);}
  async testConnection(){await this.account();}
  async fetchMetrics(input:DateRange):Promise<SyncResult>{
    const range=rangeSchema.parse(input),account=await this.account(),rows:SyncResult['rows']=[],seen=new Set<string>();let cursor:string|undefined,complete=false;
    for(let page=1;page<=100;page++){
      if(this.provider==='meta'){
        const data=record(await this.http.json(endpoint(`https://graph.facebook.com/${this.versions.meta}/act_${this.credentials.accountId}/insights`,{fields:'date_start,spend,impressions,clicks',level:'account',time_increment:'1',time_range:JSON.stringify({since:range.from,until:range.to}),limit:'100',...(cursor?{after:cursor}:{})}),{headers:this.headers()}));
        for(const raw of list(data.data)){const r=record(raw);rows.push({date:string(r.date_start),currency:account.currency,adSpend:number(r.spend),impressions:number(r.impressions),clicks:number(r.clicks)});}
        const paging=data.paging?record(data.paging):{};cursor=paging.next?string(record(paging.cursors).after):undefined;
      }else if(this.provider==='google-ads'){
        const data=await this.google(`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'`,cursor);
        for(const raw of list(data.results??[])){const r=record(raw),m=record(r.metrics);rows.push({date:string(record(r.segments).date),currency:account.currency,adSpend:number(m.costMicros??0)/1e6,impressions:number(m.impressions??0),clicks:number(m.clicks??0),conversions:number(m.conversions??0),attributedRevenue:number(m.conversionsValue??0,true)});}
        cursor=data.nextPageToken?string(data.nextPageToken):undefined;
      }else{
        const data=record(await this.http.json(endpoint('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/',{advertiser_id:this.credentials.accountId!,report_type:'BASIC',data_level:'AUCTION_ADVERTISER',dimensions:JSON.stringify(['advertiser_id','stat_time_day']),metrics:JSON.stringify(['spend','impressions','clicks']),start_date:range.from,end_date:range.to,page:String(page),page_size:'100'}),{headers:this.headers()}));this.checkTikTok(data);const result=record(data.data);
        for(const raw of list(result.list)){const r=record(raw),m=record(r.metrics);rows.push({date:string(record(r.dimensions).stat_time_day).slice(0,10),currency:account.currency,adSpend:number(m.spend),impressions:number(m.impressions),clicks:number(m.clicks)});}
        cursor=page<number(record(result.page_info).total_page)?String(page+1):undefined;
      }
      if(!cursor){complete=true;break;}if(seen.has(cursor))throw new ConnectorError('INVALID_RESPONSE');seen.add(cursor);
    }
    if(!complete)throw new ConnectorError('IMPORT_LIMIT');
    const dates=new Set<string>();for(const row of rows){sourceMetricSchema.parse(row);if(row.date<range.from||row.date>range.to||dates.has(row.date))throw new ConnectorError('INVALID_RESPONSE');dates.add(row.date);}
    return{rows,records:rows.length,timezone:account.timezone,notes:['Provider-account daily reporting timezone is preserved. Missing dates are not assumed to be zero.','Advertising attribution is provider-specific; never add attributed revenue to store sales. Google Ads conversion value includes all configured conversion actions, not purchases only.']};
  }
}
