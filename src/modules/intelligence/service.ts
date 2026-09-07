import type { TenantContext,AiProvider } from '../platform/contracts';
import { AgentOrchestrator,type IntelligenceSnapshot,type TeamResult } from './agents';
export type IntelligenceOptions={days:1|7|30;horizon:7|30};
export interface IntelligenceStore {
  snapshot(businessId:string,tenant:TenantContext,options:IntelligenceOptions):Promise<IntelligenceSnapshot>;
  reserve(businessId:string,tenant:TenantContext):Promise<void>;
  save(businessId:string,tenant:TenantContext,result:TeamResult,snapshot:IntelligenceSnapshot):Promise<{id:string}>;
}
export class IntelligenceService {
  constructor(private store:IntelligenceStore,private provider:AiProvider){}
  async review(businessId:string,tenant:TenantContext,options:IntelligenceOptions,language:'ar'|'en'){
    await this.store.reserve(businessId,tenant);
    const snapshot=await this.store.snapshot(businessId,tenant,options);
    const result=await new AgentOrchestrator(this.provider).run(snapshot,language);
    const saved=await this.store.save(businessId,tenant,result,snapshot);
    return {id:saved.id,result};
  }
}
