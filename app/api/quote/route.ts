import { getMarketQuote } from "@/lib/market-server";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.ENABLE_CHAT_PREVIEW !== "true")
    return Response.json({ status: "unavailable", code: "PREVIEW_DISABLED", message: "本地试验尚未启用。" }, { status: 404, headers });
  const result = await getMarketQuote();
  const status = result.status === "ok" ? 200 : result.code === "RATE_LIMIT" ? 429 : result.code === "INVALID_DATA" ? 502 : 503;
  return Response.json(result, { status, headers });
}
