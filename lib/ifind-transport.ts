import { connect } from "node:tls";

const host = "api-mcp.51ifind.com";
const port = 8643;
const paths = { news: "/ds-mcp-servers/hexin-ifind-ds-news-mcp", finance: "/ds-mcp-servers/hexin-ifind-ds-mcp" } as const;
const limit = 300000;
type Decoded = { status: number; headers: Headers; body: Uint8Array };

// Narrow HTTP/1.1 transport for the official MCP endpoint. TLS verification is
// mandatory; the caller cannot choose a destination, port, method or redirect.
export function decodeIfindHttp(raw: Buffer, ended = false, rpcId?: number): Decoded | null {
  if (raw.length > limit) throw Error("IFIND_RESPONSE_TOO_LARGE");
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) {
    if (raw.length > 16384 || ended) throw Error("IFIND_INVALID_HEADERS");
    return null;
  }
  if (split > 16384) throw Error("IFIND_INVALID_HEADERS");
  const lines = raw.subarray(0, split).toString("latin1").split("\r\n");
  const match = /^HTTP\/1\.[01] ([2-5]\d\d)(?: |$)/.exec(lines.shift() || "");
  if (!match) throw Error("IFIND_INVALID_STATUS");
  const status = Number(match[1]), headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) throw Error("IFIND_INVALID_HEADERS");
    headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  if (headers.has("content-encoding") && headers.get("content-encoding") !== "identity") throw Error("IFIND_UNSUPPORTED_ENCODING");
  let body = raw.subarray(split + 4), complete = ended || [204, 205, 304].includes(status);
  const transfer = headers.get("transfer-encoding");
  if (transfer && transfer.toLowerCase() !== "chunked") throw Error("IFIND_UNSUPPORTED_ENCODING");
  if (transfer) {
    if (headers.has("content-length")) throw Error("IFIND_AMBIGUOUS_FRAMING");
    const chunks: Buffer[] = []; let offset = 0; complete = false;
    while (offset < body.length) {
      const lineEnd = body.indexOf("\r\n", offset); if (lineEnd < 0) break;
      const sizeText = body.subarray(offset, lineEnd).toString("ascii").split(";")[0];
      if (!/^[\da-f]+$/i.test(sizeText)) throw Error("IFIND_INVALID_CHUNK");
      const size = parseInt(sizeText, 16); if (size > limit) throw Error("IFIND_RESPONSE_TOO_LARGE");
      offset = lineEnd + 2;
      if (size === 0) { complete = true; break; }
      if (body.length < offset + size + 2) break;
      if (body.subarray(offset + size, offset + size + 2).toString() !== "\r\n") throw Error("IFIND_INVALID_CHUNK");
      chunks.push(body.subarray(offset, offset + size)); offset += size + 2;
    }
    body = Buffer.concat(chunks);
    if (ended && !complete) throw Error("IFIND_TRUNCATED_BODY");
    headers.delete("transfer-encoding");
  } else if (headers.has("content-length")) {
    const length = headers.get("content-length")!;
    if (!/^\d+$/.test(length) || Number(length) > limit) throw Error("IFIND_INVALID_LENGTH");
    if (ended && body.length < Number(length)) throw Error("IFIND_TRUNCATED_BODY");
    complete = body.length >= Number(length); body = body.subarray(0, Number(length));
  }
  // A Streamable HTTP response can stay open after the matching RPC event.
  if (!complete && rpcId !== undefined && headers.get("content-type")?.includes("text/event-stream")) {
    const events = body.toString("utf8").replace(/\r\n/g, "\n").split("\n\n").slice(0, -1);
    complete = events.some(event => {
      const text = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!text) return false;
      try { return JSON.parse(text).id === rpcId; } catch { return false; }
    });
  }
  if (!complete) return null;
  headers.delete("content-length");
  return { status, headers, body };
}

export async function postIfindMcp(headers: Record<string, string>, body: string, signal: AbortSignal, service: keyof typeof paths = "news"): Promise<Response> {
  signal.throwIfAborted();
  if (!Object.hasOwn(paths, service)) throw Error("IFIND_INVALID_SERVICE");
  const path = paths[service];
  const pairs = Object.entries(headers);
  if (pairs.some(([name, value]) => !/^[a-z-]+$/i.test(name) || /[\r\n]/.test(value))) throw Error("IFIND_INVALID_REQUEST_HEADER");
  const rpcId = JSON.parse(body).id;
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0), settled = false;
    // Workers TLS does not implement ALPNProtocols. Without ALPN, this HTTP/1.1
    // request uses the endpoint's default protocol and still validates TLS.
    const socket = connect({ host, port, servername: host, rejectUnauthorized: true });
    const finish = (error?: unknown, decoded?: Decoded) => {
      if (settled) return; settled = true;
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else if (decoded) resolve(new Response([204,205,304].includes(decoded.status) ? null : new Uint8Array(decoded.body), {status:decoded.status,headers:decoded.headers}));
    };
    const abort = () => finish(signal.reason || Error("IFIND_ABORTED"));
    signal.addEventListener("abort", abort, {once:true});
    socket.on("error", error => finish(error));
    socket.on("secureConnect", () => {
      const request = [`POST ${path} HTTP/1.1`, `Host: ${host}:${port}`,
        ...pairs.map(([name,value]) => `${name}: ${value}`), "Accept-Encoding: identity", "Connection: close", `Content-Length: ${Buffer.byteLength(body)}`, "", body].join("\r\n");
      socket.write(request);
    });
    const consume = (ended: boolean) => {
      try { const decoded = decodeIfindHttp(received, ended, rpcId); if (decoded) finish(undefined, decoded); }
      catch (error) { finish(error); }
    };
    socket.on("data", chunk => { received = Buffer.concat([received, Buffer.from(chunk)]); consume(false); });
    socket.on("end", () => consume(true));
    if (signal.aborted) abort();
  });
}
