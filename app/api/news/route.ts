import { getNewsEvidence } from "@/lib/ifind-server";
export async function GET() {
  if (process.env.ENABLE_CHAT_PREVIEW !== "true") return Response.json({ error: "试用尚未启用。" }, { status: 404 });
  return Response.json(await getNewsEvidence(), { headers: { "Cache-Control": "no-store" } });
}
