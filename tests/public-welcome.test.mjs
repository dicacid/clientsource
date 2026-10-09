import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/routes/_authenticated/_app.tsx", import.meta.url), "utf8");

test("root renders a real welcome page rather than redirecting to /prospect", () => {
  assert.match(landing, /createFileRoute\("\/"\)/);
  assert.match(landing, /component: WelcomePage/);
  assert.doesNotMatch(landing, /throw redirect\(/);
  assert.match(landing, /<h1/);
  assert.match(landing, /id="what-it-does"/);
  assert.match(landing, /id="how-to-use"/);
});

test("new users can immediately access free research and learn both workflows", () => {
  assert.match(landing, /to="\/prospect"/);
  assert.match(landing, /No login needed/);
  assert.match(landing, /No website needed/);
  assert.match(landing, /I have a business name/);
  assert.match(landing, /I have my own website/);
  assert.match(landing, /possible competitors/i);
  assert.match(landing, /Guest-saved companies/);
  assert.match(landing, /Actual results depend on available public information/);
});

test("welcome guide is reachable from the full application menu", () => {
  assert.match(nav, /to: "\/", label: "Home \/ guide"/);
  for (const route of ["/prospect", "/prospects", "/party", "/dashboard", "/companies", "/contacts", "/import", "/members", "/settings"]) {
    assert.ok(nav.includes(`to: "${route}"`), `Missing ${route} from menu`);
  }
});
