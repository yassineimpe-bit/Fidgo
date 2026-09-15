import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/security";
export async function POST(request: Request){const origin=requireSameOrigin(request);if(!origin.ok)return NextResponse.json({error:origin.error},{status:origin.status});const r=NextResponse.json({ok:true});r.cookies.set({name:"merchant_session",value:"",httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:0});return r;}
