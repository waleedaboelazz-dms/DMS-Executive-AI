import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { ConnectorError } from '@/modules/integrations/types';
import { OperationsError } from '@/modules/operations/service';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function failure(error: unknown) {
  if(error instanceof OperationsError)return Response.json({error:error.message},{status:error.status});
  if(error instanceof ConnectorError)return Response.json({error:({AUTH_EXPIRED:'Provider token expired. Reconnect your account.',PERMISSION_DENIED:'Provider denied access. Check read permissions.',RATE_LIMITED:'Provider rate limit reached. Try again later.',PROVIDER_UNAVAILABLE:'Provider temporarily unavailable.',INVALID_RESPONSE:'Provider response could not be validated. No partial import was saved.',CONFIGURATION:'Provider configuration is incomplete. Check account IDs and server settings.',IMPORT_LIMIT:'Import exceeded the safe page limit. Use a smaller range or a dedicated backfill.',NOT_SUPPORTED:'This capability is not supported.'} as const)[error.code],code:error.code},{status:error.retryable?503:422});
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: 'Invalid request data' }, { status: 400 });
  const requestId = randomUUID();
  console.error(JSON.stringify({ event: 'request_failed', requestId, type: error instanceof Error ? error.name : 'unknown' }));
  return Response.json({ error: 'Service unavailable. Check server configuration and try again.', requestId }, { status: 503 });
}
export async function body(request: Request) {
  if(Number(request.headers.get('content-length')??0)>16_384)throw new HttpError(413,'Request too large');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Request body is required');
  const decoder=new TextDecoder();let raw='',size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16_384){await reader.cancel();throw new HttpError(413,'Request too large');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  return JSON.parse(raw);
}
