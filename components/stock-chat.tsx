"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, ChevronRight, LoaderCircle, MessageCircle, Plus, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { snapshot, evidence } from "@/lib/research";
import type { ChatMessage, ChatReply } from "@/lib/stock-chat";
import { quoteTime, quoteNotice, quoteQueryFields, type MarketResult } from "@/lib/market";

type Turn = { id: number; question: string; reply?: ChatReply; error?: string; pending?: boolean };
const starters = ["用简单的话介绍一下这家公司", "利润增长，有现金流支撑吗？", "现在还缺哪些关键信息？"];
const kindLabels = { evidence: "基于数据证据", concept: "一般概念解释", unknown: "仍待确认的判断" };

export function StockChat({ onOpenEvidence, market, onMarketChange, onOpenMarket, researchQuestion }: {
  onOpenEvidence: (id: string) => unknown; market: MarketResult | null;
  onMarketChange: (value: MarketResult) => void; onOpenMarket: () => void;
  researchQuestion?: { id: number; question: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0), [cooldown, setCooldown] = useState(0);
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const pendingEvidence = useRef<string | null>(null);

  useEffect(() => () => { sequence.current++; active.current?.abort(); }, []);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns, open]);
  useEffect(() => { if (researchQuestion) { setOpen(true); setDraft(researchQuestion.question); } }, [researchQuestion]);
  useEffect(() => {
    const update = () => setCooldown(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    update(); if (!cooldownUntil) return;
    const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [cooldownUntil]);

  async function send(question: string, retryId?: number) {
    const q = question.trim();
    if (!q || q.length > 1000 || active.current || Date.now() < cooldownUntil && !quoteQueryFields(q)) return;
    const prior = retryId ? turns.filter(t => t.id < retryId) : turns;
    // Send only completed pairs, then the current question. Keep a bounded context window.
    const completed = prior.filter(t => t.reply).slice(-5);
    while (completed.length && completed.reduce((n, t) => n + t.question.length + t.reply!.answer.length, q.length) > 18000) completed.shift();
    const messages: ChatMessage[] = completed.flatMap(t => [
      { role: "user" as const, content: t.question }, { role: "assistant" as const, content: t.reply!.answer },
    ]);
    messages.push({ role: "user", content: q });
    const id = ++sequence.current;
    const controller = new AbortController();
    active.current = controller;
    setTurns([...prior, { id, question: q, pending: true }]);
    setDraft(""); setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }), signal: controller.signal });
      const data = await response.json() as ChatReply & { error?: string; code?: string; retryAfterSeconds?: number };
      if (data.code === "RATE_LIMIT") setCooldownUntil(Date.now() + Math.max(1,data.retryAfterSeconds || 30) * 1000);
      if (!response.ok) throw new Error(data.error || "回答未完成，请重试。");
      if (!data.answer || !Array.isArray(data.evidenceIds) || !Array.isArray(data.facts) ||
        !Array.isArray(data.followups) || !Object.hasOwn(kindLabels, data.kind)) throw new Error("回答格式异常，请重试。");
      if (sequence.current === id) {
        if (data.market) onMarketChange(data.market);
        setTurns(prev => prev.map(t => t.id === id ? { ...t, pending: false, reply: data } : t));
      }
    } catch (error) {
      if (sequence.current === id) setTurns(prev => prev.map(t => t.id === id ? { ...t, pending: false,
        error: controller.signal.aborted ? "已停止本次回答，可以重试。" : error instanceof Error ? error.message : "连接失败，请重试。",
      } : t));
    } finally {
      if (sequence.current === id) { active.current = null; setBusy(false); textarea.current?.focus(); }
    }
  }

  function reset() {
    sequence.current++; active.current?.abort(); active.current = null;
    setBusy(false); setTurns([]); setDraft(""); textarea.current?.focus();
  }

  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><button className="stock-chat-launcher" aria-label="打开股票对话">
      <MessageCircle size={20} /><span>问问证研</span>
    </button></SheetTrigger>
    <SheetContent className="stock-chat-sheet" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); textarea.current?.focus(); }}
      onCloseAutoFocus={event => {
        if (pendingEvidence.current) {
          event.preventDefault(); const id = pendingEvidence.current; pendingEvidence.current = null;
          if (id === "M01") onOpenMarket(); else onOpenEvidence(id);
        }
      }}>
      <SheetHeader className="stock-chat-header">
        <div className="stock-chat-heading"><span className="stock-chat-avatar"><Sparkles size={20} /></span>
          <div><SheetTitle>和证研聊聊</SheetTitle><SheetDescription>宁德时代 · 连续追问，沿证据深入</SheetDescription></div>
          <button className="stock-chat-icon-button" aria-label="开启新对话" title="开启新对话" onClick={reset}><Plus size={19} /></button>
          <SheetClose asChild><button className="stock-chat-icon-button" aria-label="关闭股票对话"><X size={19} /></button></SheetClose>
        </div>
      </SheetHeader>
      <div className="stock-chat-context"><span className="stock-chat-live-dot" /> 财报快照 · 2026 半年报<span>{market?.status === "ok" ? "已取得行情快照" : "行情暂未获得"}</span></div>
      <div className="stock-chat-messages" role="log" aria-label="股票对话记录" aria-live="polite" aria-relevant="additions text">
        <div className="stock-chat-greeting">
          <span className="stock-chat-sender"><Sparkles size={14} /> 证研</span>
          <h3>关于宁德时代的问题，<br />可以问我～</h3>
          <p>看不懂的指标、拿不准的判断，都可以聊。我会结合现有证据解释，也会告诉你哪些还不能确定。</p>
          {turns.length === 0 && <div className="stock-chat-starters">{starters.map(q => <button key={q} onClick={() => void send(q)}>{q}<ChevronRight size={15} /></button>)}</div>}
        </div>
        {turns.map((turn, index) => <div className="stock-chat-turn" key={turn.id}>
          <div className="stock-chat-user"><span className="sr-only">你：</span>{turn.question}</div>
          <div className="stock-chat-assistant">
            <span className="stock-chat-sender"><Sparkles size={14} /> 证研</span>
            {turn.pending && <div className="stock-chat-thinking" role="status"><LoaderCircle className="spin" size={15} />{quoteQueryFields(turn.question) ? "正在查询行情…" : "正在查询相关资料，并请模型解释…"}</div>}
            {turn.error && <div className="stock-chat-error" role="alert"><p>{turn.error}</p>{index === turns.length - 1 && <button disabled={busy || cooldown > 0} onClick={() => void send(turn.question, turn.id)}><RotateCcw size={13} />{cooldown > 0 ? `约 ${cooldown} 秒后可重试` : "重试这个问题"}</button>}</div>}
            {turn.reply && <>
              <span className={"stock-chat-kind " + turn.reply.kind}>{turn.reply.mode === "boundary" ? "研究边界提示 · 未调用模型" : turn.reply.mode === "data" ? turn.reply.evidenceIds.every(id=>id==="M01") ? "行情查询 · 接口数据" : "已取得资料整理" : turn.reply.evidenceIds.some(id => id.startsWith("N")) ? "新闻线索解读 · 需原文核验" : kindLabels[turn.reply.kind]}</span>
              <p className="stock-chat-answer">{turn.reply.answer}</p>
              {turn.reply.notice && <p className="stock-chat-boundary">{turn.reply.notice}</p>}
              {turn.reply.evidenceIds.includes("E02") && <p className="stock-chat-boundary">口径提醒：合并经营现金流与归母利润口径不同，比值不能单独证明盈利质量。</p>}
              {turn.reply.evidenceIds.length > 0 && <div className="stock-chat-citations">{turn.reply.evidenceIds.map(id => <button key={id}
                title={id === "M01" ? "查看本次引用的行情与时点" : turn.reply?.sources?.find(s => s.id === id)?.title || evidence.find(e => e.id === id)?.title} onClick={() => {
                  if (turn.reply?.sources?.some(s => s.id === id)) { setSourceOpen(sourceOpen === `${turn.id}-${id}` ? null : `${turn.id}-${id}`); return; }
                  if (id === "M01" && turn.reply?.market) onMarketChange(turn.reply.market);
                  pendingEvidence.current = id; setOpen(false);
                }}>
                {id === "M01" ? "M01 行情" : id}<ArrowUpRight size={12} /></button>)}<span>点击复核证据</span></div>}
              {turn.reply.sources?.filter(source => sourceOpen === `${turn.id}-${source.id}`).map(source => <section className="stock-chat-source" key={source.id}>
                <strong>{source.id} · {source.title}</strong><span>{source.timing}</span><p>{source.text}</p>{source.warnings?.length ? <p className="stock-chat-boundary">{source.warnings.join(" ")}</p> : null}<a href={source.url} target="_blank" rel="noreferrer">{source.linkLabel || "打开来源"} ↗</a>
              </section>)}
              {turn.reply.context && Object.entries(turn.reply.context).filter(([,result]) => result.status === "unavailable").map(([name,result]) => <p className="stock-chat-boundary" key={name}>{result.status === "unavailable" ? result.message : ""}</p>)}
              {turn.reply.evidenceIds.includes("M01") && turn.reply.market?.status === "ok" && <p className="stock-chat-boundary">
                行情时点：{quoteTime(turn.reply.market.quote.sourceTimestamp)}（北京时间）。{quoteNotice(turn.reply.market.quote)}
              </p>}
              {turn.reply.facts.length > 0 && <details className="stock-chat-facts"><summary><Check size={12} /> 数值来源与口径</summary>
                {turn.reply.facts.map(fact => <div key={fact.key}><strong>{fact.label} · {fact.value}</strong><span>{fact.period} · <a href={fact.sourceUrl || snapshot.source + "#page=" + (fact.page + 1)} target="_blank" rel="noreferrer">{fact.sourceUrl ? "查看数据来源" : `报告 P${fact.page}`} ↗</a></span></div>)}
              </details>}
              {index === turns.length - 1 && <div className="stock-chat-followups">{turn.reply.followups.map(q => <button key={q} disabled={busy || cooldown > 0} onClick={() => void send(q)}>{q}<ChevronRight size={12} /></button>)}</div>}
            </>}
          </div>
        </div>)}
        <div ref={end} />
      </div>
      <div className="stock-chat-bottom">
        <form className="stock-chat-composer" onSubmit={event => { event.preventDefault(); void send(draft); }}>
          <textarea ref={textarea} aria-label="向证研提问" placeholder="想了解这只股票的什么？" value={draft} maxLength={1000} rows={2}
            onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault(); if (!busy) void send(draft);
              }
            }} />
          <div className="stock-chat-composer-bottom"><span>{cooldown > 0 ? `模型暂缓约 ${cooldown} 秒 · 行情仍可查询` : draft.length > 800 ? `${draft.length} / 1000` : "可连续追问 · Enter 发送"}</span>
            {busy ? <button type="button" className="stock-chat-send stock-chat-stop" aria-label="停止回答" onClick={() => active.current?.abort()}><Square size={14} /></button> :
            <button type="submit" className="stock-chat-send" aria-label="发送问题" disabled={!draft.trim() || cooldown > 0 && !quoteQueryFields(draft)}><ArrowUp size={18} /></button>}
          </div>
        </form>
        <p className="stock-chat-footnote">AI 解释需结合原文核验 · 不提供买卖建议</p>
        {turns.filter(t => t.reply).length > 5 && <p className="stock-chat-footnote">本次回答参考最近五轮完整对话；更早的问题可重新补充。</p>}
      </div>
    </SheetContent>
  </Sheet>;
}
