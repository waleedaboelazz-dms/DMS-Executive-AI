import type { TenantContext } from '../platform/contracts';
import { connectionSchema,rangeSchema,ConnectorError,type Credentials,type ProviderId,type DateRange,type ReadConnector,type SyncResult,type CatalogResult } from './types';
export type SyncClaim={runId:string;integrationId:string;businessId:string;version:number;owner:string;provider:ProviderId;credentials:Credentials;range:DateRange};
export interface IntegrationStore {
  authorize(businessId:string,tenant:TenantContext):Promise<void>;
  connect(businessId:string,tenant:TenantContext,provider:ProviderId,credentials:Credentials):Promise<void>;
  disconnect(businessId:string,tenant:TenantContext,provider:ProviderId):Promise<void>;
  request(businessId:string,tenant:TenantContext,provider:ProviderId,range:DateRange):Promise<string>;
  claim(runId:string):Promise<SyncClaim|null>;
  credential(claim:SyncClaim,credentials:Credentials):Promise<void>;
  complete(claim:SyncClaim,result:SyncResult):Promise<void>;
  fail(claim:SyncClaim,code:string):Promise<void>;
  // Optional: catalog (products/customers) sync is best-effort and never blocks or reverts a successful metrics sync.
  completeCatalog?(claim:SyncClaim,result:CatalogResult):Promise<void>;
  catalogFailed?(claim:SyncClaim,code:string):Promise<void>;
}
export interface SyncQueue { enqueue(runId:string):Promise<void>; }
export class IntegrationService {
  constructor(private store:IntegrationStore,private factory:(provider:ProviderId,credentials:Credentials)=>ReadConnector,private queue:SyncQueue,private refresh:(provider:ProviderId,credentials:Credentials)=>Promise<Credentials>=async(_p,c)=>c){}
  async connect(businessId:string,tenant:TenantContext,provider:ProviderId,input:Credentials){await this.store.authorize(businessId,tenant);const credentials=await this.refresh(provider,connectionSchema.parse(input));await this.factory(provider,credentials).testConnection();await this.store.connect(businessId,tenant,provider,credentials);}
  disconnect(businessId:string,tenant:TenantContext,provider:ProviderId){return this.store.disconnect(businessId,tenant,provider);}
  async sync(businessId:string,tenant:TenantContext,provider:ProviderId,range:DateRange){const id=await this.store.request(businessId,tenant,provider,rangeSchema.parse(range));await this.queue.enqueue(id);return{id};}
  async execute(runId:string){
    const claim=await this.store.claim(runId);if(!claim)return;
    let credentials:Credentials;
    try{credentials=await this.refresh(claim.provider,claim.credentials);if(credentials!==claim.credentials)await this.store.credential(claim,credentials);const connector=this.factory(claim.provider,credentials);const result=await connector.fetchMetrics(claim.range);await this.store.complete(claim,result);}
    catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_UNAVAILABLE';await this.store.fail(claim,code);throw error instanceof ConnectorError?error:new Error(code);}
    // Catalog sync runs after a successful metrics sync and never undoes it on failure.
    if(this.store.completeCatalog){try{const connector=this.factory(claim.provider,credentials);if(connector.fetchCatalog){const catalog=await connector.fetchCatalog();await this.store.completeCatalog(claim,catalog);}}
    catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_UNAVAILABLE';if(error instanceof ConnectorError&&error.code==='NOT_SUPPORTED'){/* provider has no catalog capability */}else await this.store.catalogFailed?.(claim,code);}}
  }
}
