import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/security";
export async function POST(request:Request){const origin=requireSameOrigin(request);if(!origin.ok)return NextResponse.json({error:origin.error},{status:origin.status});const response=NextResponse.json({ok:true});response.cookies.set({name:"loyalty_staff",value:"",httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:0});return response;}
