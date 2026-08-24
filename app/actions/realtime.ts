"use server";

import { getToken } from "@/lib/auth";

/**
 * Hands the client the pieces it needs to open a realtime connection:
 * - access token (httpOnly cookie) → socket.io auth + Supabase session
 * - backend WebSocket URL (server env) → never hard-coded in the bundle
 */
export async function getRealtimeSession(): Promise<{
  token: string | null;
  wsUrl: string;
}> {
  const token = await getToken();
  const wsUrl =
    process.env.NEXT_PUBLIC_WS_URL ||
    (process.env.NEXT_PUBLIC_API_SERVER
      ? process.env.NEXT_PUBLIC_API_SERVER.replace(/^http/, "ws")
      : "");
  return { token, wsUrl };
}
