import test from "node:test";
import assert from "node:assert/strict";
import { parseBingRss, searchPublicWeb } from "../src/lib/prospect/search.server.ts";

const rss = `<rss><channel>
  <item><title>Butlers Events Hire | Business Listing</title>
    <link>https://example.org/companies/butlers?suburb=Cardiff&amp;region=NSW</link>
    <description><![CDATA[Butlers Events Hire - marquees &amp; party equipment in Cardiff NSW]]></description>
  </item>
  <item><title>Invalid source</title><link>javascript:alert(1)</link><description>nope</description></item>
  <item><title>Search home</title><link>https://www.bing.com/search?q=test</link></item>
</channel></rss>`;

test("RSS parser returns linked public listings without inventing company domains", () => {
  const parsed = parseBingRss(rss);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "Butlers Events Hire | Business Listing");
  assert.equal(parsed[0].url, "https://example.org/companies/butlers?suburb=Cardiff&region=NSW");
  assert.match(parsed[0].snippet, /Cardiff NSW/);
  assert.equal(parseBingRss("<rss><channel></channel></rss>").length, 0);
});

test("public lookup targets the fixed search host and degrades when search is unavailable", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).hostname, "www.bing.com");
      assert.equal(new URL(url).searchParams.get("format"), "rss");
      assert.match(new URL(url).searchParams.get("q"), /Butlers Events Hire/);
      return new Response(rss, { status: 200 });
    };
    const found = await searchPublicWeb("Butlers Events Hire Cardiff NSW");
    assert.equal(found.length, 1);
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    assert.deepEqual(await searchPublicWeb("Butlers Events Hire"), []);
  } finally {
    globalThis.fetch = original;
  }
});
