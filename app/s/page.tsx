import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ScannerClient } from "@/components/scanner-client";
export default async function ScannerPage(){const s=await getSession();if(!s)redirect("/login");return <ScannerClient/>}
