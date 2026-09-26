import { getMarketQuote } from "./market-server";
import { getPriceHistory, getValuation } from "./market-analysis-server";
import { getNewsEvidence } from "./ifind-server";
import { integratedDiagnosis } from "./integrated-diagnosis";

export async function collectDiagnosis(question:string) {
 const unavailable={status:"unavailable" as const,code:"CONNECTION_ERROR",message:"查询失败，未取得可验证的数据。"};
 // Separate failures must not discard the financial snapshot or other successful sources.
 const [market,history,valuation,news]=await Promise.all([
  getMarketQuote().catch(()=>unavailable),getPriceHistory().catch(()=>unavailable),
  getValuation().catch(()=>unavailable),getNewsEvidence().catch(()=>unavailable),
 ]);
 return integratedDiagnosis(question,{market,history,valuation,news});
}
