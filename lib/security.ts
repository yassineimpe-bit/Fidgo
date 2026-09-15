import { createHash } from "node:crypto";
export function requestIp(req:Request):string{const forwarded=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();return forwarded||req.headers.get("x-real-ip")||"unknown";}
export function hashRateKey(value:string):string{return createHash("sha256").update(value).digest("hex");}
function configuredOrigin():string|null{const raw=process.env.NEXT_PUBLIC_APP_URL;if(!raw)return null;try{return new URL(raw).origin;}catch{return null;}}
export function isSameOrigin(req:Request):boolean{const origin=req.headers.get("origin");if(!origin)return true;try{const originUrl=new URL(origin);const configured=configuredOrigin();if(configured&&originUrl.origin===configured)return true;const host=req.headers.get("x-forwarded-host")||req.headers.get("host");if(!host||originUrl.host!==host)return false;const proto=req.headers.get("x-forwarded-proto");return !proto||originUrl.protocol===`${proto}:`;}catch{return false;}}
export function requireSameOrigin(req:Request):{ok:true}|{ok:false;error:string;status:number}{return isSameOrigin(req)?{ok:true}:{ok:false,error:"INVALID_ORIGIN",status:403};}
export function rejectCrossOrigin(req:Request):Response|null{return isSameOrigin(req)?null:Response.json({error:"INVALID_ORIGIN"},{status:403});}
