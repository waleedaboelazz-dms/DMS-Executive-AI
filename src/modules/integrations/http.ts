import { ConnectorError } from './types';
export type Transport=(url:string,init?:RequestInit)=>Promise<Response>;
const hosts=new Set(['api.salla.dev','accounts.salla.sa','api.zid.sa','oauth.zid.sa','graph.facebook.com','business-api.tiktok.com','googleads.googleapis.com','analyticsdata.googleapis.com','analyticsadmin.googleapis.com','oauth2.googleapis.com','www.googleapis.com']);
export class ProviderHttp {
  private readonly started=Date.now();
  constructor(private transport:Transport=fetch,private sleep:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){}
  async json(url:string,init:RequestInit={},retry=true):Promise<unknown>{
    const target=new URL(url);if(target.protocol!=='https:'||!hosts.has(target.hostname)||target.username||target.password||target.port)throw new ConnectorError('CONFIGURATION');
    for(let attempt=0;attempt<(retry?3:1);attempt++){
      if(Date.now()-this.started>8*60000)throw new ConnectorError('IMPORT_LIMIT');
      let response:Response;
      try{response=await this.transport(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{if(retry&&attempt<2){await this.sleep(500*2**attempt);continue;}throw new ConnectorError('PROVIDER_UNAVAILABLE',true);}
      if(response.status===401)throw new ConnectorError('AUTH_EXPIRED');
      if(response.status===403)throw new ConnectorError('PERMISSION_DENIED');
      if(response.status===429||response.status>=500){if(retry&&attempt<2){const seconds=Number(response.headers.get('retry-after'));await this.sleep(Math.min(10000,Math.max(500*2**attempt,Number.isFinite(seconds)?seconds*1000:0)));continue;}throw new ConnectorError(response.status===429?'RATE_LIMITED':'PROVIDER_UNAVAILABLE',true);}
      if(!response.ok)throw new ConnectorError('INVALID_RESPONSE');
      // Bound provider responses; never persist or log raw errors/PII.
      const reader=response.body?.getReader();if(!reader)throw new ConnectorError('INVALID_RESPONSE');let size=0,text='';const decoder=new TextDecoder();
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8_000_000){await reader.cancel();throw new ConnectorError('IMPORT_LIMIT');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}catch(e){if(e instanceof ConnectorError)throw e;throw new ConnectorError('INVALID_RESPONSE');}finally{reader.releaseLock();}
    }
    throw new ConnectorError('PROVIDER_UNAVAILABLE',true);
  }
}
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ConnectorError('INVALID_RESPONSE');return value as Record<string,unknown>;}
export function list(value:unknown):unknown[]{if(!Array.isArray(value))throw new ConnectorError('INVALID_RESPONSE');return value;}
export function number(value:unknown,signed=false):number{if((typeof value!=='number'&&typeof value!=='string')||value==='')throw new ConnectorError('INVALID_RESPONSE');const n=Number(value);if(!Number.isFinite(n)||(!signed&&n<0))throw new ConnectorError('INVALID_RESPONSE');return n;}
export function string(value:unknown):string{if(typeof value!=='string'||!value)throw new ConnectorError('INVALID_RESPONSE');return value;}
export function endpoint(base:string,params:Record<string,string>):string{const url=new URL(base);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);return url.toString();}
