import { sql } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(){const started=Date.now();try{await sql`select 1 as ok`;return Response.json({ok:true,service:"fidgo",database:"up",serverMs:Date.now()-started},{headers:{"cache-control":"no-store"}})}catch{return Response.json({ok:false,service:"fidgo",database:"down",serverMs:Date.now()-started},{status:503,headers:{"cache-control":"no-store"}})}}
