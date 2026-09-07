import { ConnectorError, rangeSchema, sourceMetricSchema, normalizedProductSchema, normalizedCustomerSchema, type Credentials,type DateRange,type ProviderId,type ReadConnector,type SourceMetric,type SyncResult,type CatalogResult,type NormalizedProduct,type NormalizedCustomer } from '../types';
import { ProviderHttp,endpoint,record,list,number,string } from '../http';

export class CommerceConnector implements ReadConnector {
  readonly provider:'salla'|'zid';
  constructor(provider:'salla'|'zid',private credentials:Credentials,private http=new ProviderHttp()){this.provider=provider;if(provider==='zid'&&!credentials.authorizationToken)throw new ConnectorError('CONFIGURATION');}
  private async page(page:number,range?:DateRange){
    const salla=this.provider==='salla';
    const url=endpoint(salla?'https://api.salla.dev/admin/v2/orders':'https://api.zid.sa/v1/managers/store/orders',{page:String(page),per_page:salla?'30':'15',...(!salla?{payload_type:'simple'}:{}),...(salla&&range?{from_date:range.from,to_date:range.to}:{})});
    const headers:Record<string,string>=salla?{Authorization:`Bearer ${this.credentials.accessToken}`}:{Authorization:this.credentials.authorizationToken!,'X-Manager-Token':this.credentials.accessToken,'Accept-Language':'en'};
    const data=record(await this.http.json(url,{headers}));
    if(salla&&data.success!==true)throw new ConnectorError('INVALID_RESPONSE');
    return data;
  }
  async testConnection(){const data=await this.page(1);list(this.provider==='salla'?data.data:data.orders);}
  async fetchMetrics(input:DateRange):Promise<SyncResult>{
    const range=rangeSchema.parse(input),seen=new Set<string>(),daily=new Map<string,SourceMetric>();let records=0,finished=false,timezone='Asia/Riyadh';
    for(let page=1;page<=100;page++){
      const data=await this.page(page,range),items=list(this.provider==='salla'?data.data:data.orders);
      for(const raw of items){
        const order=record(raw),id=String(order.id);if(order.id===undefined||seen.has(id))throw new ConnectorError('INVALID_RESPONSE');seen.add(id);
        const salla=this.provider==='salla';
        const date=salla?string(record(order.date).date).slice(0,10):string(order.created_at).slice(0,10);
        if(salla)timezone=string(record(order.date).timezone);
        if(date<range.from||date>range.to)continue;
        const currency=salla?string(record(order.total).currency):string(order.currency_code);
        const amount=salla?number(record(order.total).amount):number(order.order_total);
        // Gross order value is deliberately NOT recognized/net revenue. Includes unpaid/cancelled orders.
        const key=date+':'+currency,current=daily.get(key)??{date,currency,grossSales:0,orders:0};
        current.grossSales=Math.round((current.grossSales!+amount)*100)/100;current.orders!++;sourceMetricSchema.parse(current);daily.set(key,current);records++;
      }
      const totalPages=this.provider==='salla'?number(record(data.pagination).totalPages):Math.ceil(number(data.total_order_count)/15);
      if(page>=Math.max(1,totalPages)){finished=true;break;}
      if(!items.length)throw new ConnectorError('INVALID_RESPONSE');
    }
    if(!finished)throw new ConnectorError('IMPORT_LIMIT');
    return {rows:[...daily.values()],records,timezone,notes:['Gross order value includes taxes, shipping, unpaid and cancelled orders; it is not recognized revenue or cash collected. Refund reconciliation and COGS are not supplied.',...(this.provider==='zid'?['Dates follow the store API calendar; verify the store timezone. Zid scans up to 1,500 orders and fails closed if the store exceeds this limit.']:[])]};
  }
  private money(value:unknown):number{const m=record(value);return number(m.amount);}
  private optionalMoney(value:unknown):number|undefined{if(value===null||value===undefined)return undefined;return this.money(value);}
  private optionalNumber(value:unknown):number|undefined{if(value===null||value===undefined)return undefined;return number(value);}
  private optionalString(value:unknown):string|undefined{return typeof value==='string'&&value?value:undefined;}
  // Salla only: Zid's catalog/customer endpoints are not documented/tested here, so fetchCatalog is not offered for it.
  async fetchCatalog():Promise<CatalogResult>{
    if(this.provider!=='salla')throw new ConnectorError('NOT_SUPPORTED');
    let currency='SAR';
    const products:NormalizedProduct[]=[],seenProducts=new Set<string>();
    for(let page=1;page<=50;page++){
      const url=endpoint('https://api.salla.dev/admin/v2/products',{page:String(page),per_page:'30'});
      const data=record(await this.http.json(url,{headers:{Authorization:`Bearer ${this.credentials.accessToken}`}}));
      if(data.success!==true)throw new ConnectorError('INVALID_RESPONSE');
      const items=list(data.data);
      for(const raw of items){
        const p=record(raw),id=String(p.id);if(p.id===undefined||seenProducts.has(id))throw new ConnectorError('INVALID_RESPONSE');seenProducts.add(id);
        const price=this.money(p.price);if(p.price&&typeof p.price==='object')currency=this.optionalString(record(p.price).currency)??currency;
        products.push(normalizedProductSchema.parse({externalId:id,name:string(p.name),sku:this.optionalString(p.sku),price,salePrice:this.optionalMoney(p.sale_price),inventoryQuantity:this.optionalNumber(p.quantity),status:string(p.status)}));
      }
      const totalPages=number(record(data.pagination).totalPages);
      if(page>=Math.max(1,totalPages))break;
      if(!items.length)throw new ConnectorError('INVALID_RESPONSE');
      if(page===50)throw new ConnectorError('IMPORT_LIMIT');
    }
    const customers:NormalizedCustomer[]=[],seenCustomers=new Set<string>();
    for(let page=1;page<=50;page++){
      const url=endpoint('https://api.salla.dev/admin/v2/customers',{page:String(page),per_page:'30'});
      const data=record(await this.http.json(url,{headers:{Authorization:`Bearer ${this.credentials.accessToken}`}}));
      if(data.success!==true)throw new ConnectorError('INVALID_RESPONSE');
      const items=list(data.data);
      for(const raw of items){
        const c=record(raw),id=String(c.id);if(c.id===undefined||seenCustomers.has(id))throw new ConnectorError('INVALID_RESPONSE');seenCustomers.add(id);
        const name=[c.first_name,c.last_name].filter(v=>typeof v==='string'&&v).join(' ')||`Customer ${id}`;
        customers.push(normalizedCustomerSchema.parse({externalId:id,name,email:this.optionalString(c.email),phone:this.optionalString(c.mobile),totalOrders:this.optionalNumber(c.orders_count),totalSpent:this.optionalMoney(c.total_spent)}));
      }
      const totalPages=number(record(data.pagination).totalPages);
      if(page>=Math.max(1,totalPages))break;
      if(!items.length)throw new ConnectorError('INVALID_RESPONSE');
      if(page===50)throw new ConnectorError('IMPORT_LIMIT');
    }
    return {products,customers,currency,notes:['Product catalog includes price and stock only; order-to-product line items are not imported, so sales-based product ranking is not available.','Customer order-count/spend fields are only populated when the connected Salla account exposes them; missing fields are left unknown, not zero.']};
  }
}
