import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

const chromiumExtensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

function isExtensionApi(pathname: string): boolean {
  return pathname.startsWith("/api/extension/") || pathname === "/api/interventions";
}

function setExtensionCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (!origin || !chromiumExtensionOrigin.test(origin) || !isExtensionApi(request.nextUrl.pathname)) {
    return response;
  }
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Max-Age", "3600");
  response.headers.append("Vary", "Origin");
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.method === "OPTIONS" && isExtensionApi(request.nextUrl.pathname)) {
    return setExtensionCors(request, new NextResponse(null, { status: 204 }));
  }
  return setExtensionCors(request, await updateSession(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
