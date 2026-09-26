export const ifindGuide = "https://mcp.51ifind.com/#/docs/guide-prepare";
export type NewsArticle = { id: string; title: string; excerpt: string; publishedAt: string; url: string | null; source: string; warnings: string[] };
export type NewsResult = { status: "unavailable"; code: string; message: string } | {
  status: "ok"; text: string; fetchedAt: number; from: string; to: string; tool: string; links: string[];
  articles: NewsArticle[];
};
