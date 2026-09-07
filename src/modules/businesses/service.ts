import { z } from 'zod';
import type { TenantContext } from '../platform/contracts';
export const businessNameSchema=z.string().trim().min(2).max(80);
export interface BusinessRepository {
  provision(userId:string,name:string):Promise<{id:string;name:string}>;
  create(tenant:TenantContext,name:string):Promise<{id:string;name:string}>;
  list(tenant:TenantContext):Promise<{id:string;name:string}[]>;
}
export class BusinessService {
  constructor(private readonly repository:BusinessRepository){}
  provision(userId:string,name:string){return this.repository.provision(userId,businessNameSchema.parse(name));}
  create(tenant:TenantContext,name:string){return this.repository.create(tenant,businessNameSchema.parse(name));}
  list(tenant:TenantContext){return this.repository.list(tenant);}
}
