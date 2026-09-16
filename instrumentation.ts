import type { Instrumentation } from "next";
import { redactSensitivePath } from "@/lib/observability";

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const value = error instanceof Error ? error : new Error(String(error));
  console.error("RETIKO_SERVER_ERROR", {
    name: value.name,
    digest: "digest" in value ? String(value.digest || "") : "",
    method: request.method,
    path: redactSensitivePath(request.path),
    route: context.routePath,
    routeType: context.routeType,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
  });
};
