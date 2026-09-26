import { buildAndroidAssetLinks } from "@/lib/android-app";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(buildAndroidAssetLinks(), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
