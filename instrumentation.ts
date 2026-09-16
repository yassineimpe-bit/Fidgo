import type { Instrumentation } from "next";

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const value = error instanceof Error ? error : new Error(String(error));
  console.error("RETIKO_SERVER_ERROR", {
    name: value.name,
    digest: "digest" in value ? String(value.digest || "") : "",
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
  });
};
