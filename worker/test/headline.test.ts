import { describe, expect, it } from "vitest";
import { parseTopStory } from "../src/headline";

describe("BBC headline", () => {
  it("takes the first item title, not the channel title", () => {
    const xml = `<rss><channel><title><![CDATA[BBC News]]></title>
      <item><title><![CDATA[Ministers &amp; unions agree deal]]></title></item>
      <item><title>Second</title></item></channel></rss>`;
    expect(parseTopStory(xml)).toBe("Ministers & unions agree deal");
  });

  it("handles plain titles and empty feeds", () => {
    expect(parseTopStory("<item><title>Rain &#8216;on the way&#8217;</title></item>")).toBe("Rain ‘on the way’");
    expect(parseTopStory("<rss></rss>")).toBeNull();
  });
});
