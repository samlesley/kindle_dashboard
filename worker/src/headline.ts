// BBC News top story: the first <item> title in the RSS feed.

import { decodeEntities } from "./trains/ldb";
import { upstream } from "./upstream";

export const BBC_RSS_URL = "https://feeds.bbci.co.uk/news/rss.xml";

export function parseTopStory(xml: string): string | null {
  const item = /<item\b[^>]*>([\s\S]*?)<\/item>/i.exec(xml);
  if (!item) return null;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(item[1]);
  if (!title) return null;
  const text = title[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  const clean = decodeEntities(text).replace(/\s+/g, " ").trim();
  return clean || null;
}

export async function fetchTopStory(fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await upstream("BBC", fetchFn, BBC_RSS_URL, { headers: { "user-agent": "kindle-dashboard/1.0" } });
  const story = parseTopStory(await res.text());
  if (!story) throw new Error("BBC FEED EMPTY");
  return story;
}
