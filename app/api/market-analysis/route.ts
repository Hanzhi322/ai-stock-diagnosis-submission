import { getPriceHistory, getValuation } from "@/lib/market-analysis-server";
export async function GET() {
  if (process.env.ENABLE_CHAT_PREVIEW !== "true") return Response.json({ error: "试用尚未启用。" }, { status: 404 });
  const [history, valuation] = await Promise.all([getPriceHistory(), getValuation()]);
  return Response.json({ history, valuation }, { headers: { "Cache-Control": "no-store" } });
}
