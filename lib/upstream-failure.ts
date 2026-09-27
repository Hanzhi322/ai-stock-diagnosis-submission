type Provider = "model" | "ifind-news" | "ifind-research";
export type UpstreamFailure = {
  status: number;
  reason: "authentication" | "region_restricted" | "model_permission" | "model_unavailable" | "access_denied" | "rate_limit" | "bad_request" | "upstream_error";
};

// Provider error bodies may echo credentials. Raw bodies never reach the browser.
export function redactUpstreamError(value: string, secrets: string[]): string {
  let text = value;
  for (const secret of secrets.flatMap(value => {
    const unquoted=value.trim().replace(/^["']|["']$/g, "").trim();
    return [value, value.trim(), unquoted, unquoted.replace(/^Bearer\s+/i, "").trim()];
  }).filter(Boolean).sort((a,b) => b.length-a.length)) {
    text = text.replaceAll(secret, "[redacted]");
  }
  return text.replace(/(?:gsk_|sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|token|secret|api_key|access_token)=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 600);
}

export function classifyUpstreamFailure(status: number, body: unknown): UpstreamFailure {
  const content = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const reason = status === 429 ? "rate_limit" :
    /(?:unsupported_country_region_territory|region.{0,40}(?:not supported|unsupported|restricted)|(?:not supported|unsupported|restricted).{0,40}(?:country|region|territory))/i.test(content) ? "region_restricted" :
    /model_permission_blocked|model.{0,60}blocked at (?:the )?(?:organization|project) level/i.test(content) ? "model_permission" :
    /model_not_found|model_decommissioned/i.test(content) ? "model_unavailable" :
    status === 401 || /invalid_api_key|invalid.{0,10}(?:api key|token)|authentication failed/i.test(content) ? "authentication" :
    status === 403 ? "access_denied" : status === 400 ? "bad_request" : "upstream_error";
  return { status, reason };
}

export function logUpstreamFailure(provider: Provider, phase: string, status: number, body: unknown): UpstreamFailure {
  const failure = classifyUpstreamFailure(status, body);
  const secrets = Object.entries(process.env).flatMap(([key,value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value ? [value] : []);
  console.warn("upstream_failure", JSON.stringify({provider, phase, ...failure,
    detail:redactUpstreamError(typeof body === "string" ? body : JSON.stringify(body ?? {}), secrets)}));
  return failure;
}

export async function readUpstreamError(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder(); let text = "", size = 0;
  try {
    while (size < 8192) {
      const {value,done} = await reader.read(); if (done) break;
      const chunk = value.subarray(0, 8192-size); size += chunk.byteLength;
      text += decoder.decode(chunk,{stream:true});
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(()=>{}); }
  try { return JSON.parse(text); } catch { return text; }
}

export function modelFailureMessage(failure: UpstreamFailure): string {
  if (failure.reason === "authentication") return "模型服务认证失败，需要检查服务端密钥配置。";
  if (failure.reason === "region_restricted") return "模型服务暂不支持当前部署地区，暂时无法生成回答。";
  if (failure.reason === "model_permission") return "当前模型的调用权限未开通，暂时无法生成回答。";
  if (failure.reason === "model_unavailable") return "配置的模型目前不可用，需要检查模型名称或服务状态。";
  if (failure.reason === "access_denied") return "模型服务拒绝了此次访问，需要检查服务权限或服务器网络限制。";
  return "模型服务暂时不可用，未生成新的回答。";
}
