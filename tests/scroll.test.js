// Scrolling rules for the internal dashboard. Static checks on the stylesheet
// and the table primitive, so a later edit cannot quietly bring back the
// trackpad bounce above the bar or a strip that also scrolls up and down.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");
const parts = readFileSync(new URL("../src/pages/admin/parts.tsx", import.meta.url), "utf8");
const rule = (source, selector) => {
  const at = source.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} rule exists`);
  return source.slice(at, source.indexOf("}", at));
};
const phone = css.slice(css.indexOf("@media (max-width: 960px)"));

test("the document never rubber bands on the internal host", () => {
  assert.match(rule(css, "html"), /overscroll-behavior-y:\s*none/);
});

test("the phone section strip scrolls sideways only", () => {
  const nav = rule(phone, ".admin-nav");
  assert.match(nav, /overflow-x:\s*auto/);
  assert.match(nav, /overflow-y:\s*hidden/);
  assert.match(nav, /overscroll-behavior-x:\s*contain/);
});

test("a phone table is a sideways strip and the page scrolls its rows", () => {
  const wrap = rule(phone, ".admin-table-wrap");
  assert.match(wrap, /overflow-y:\s*hidden/);
  assert.match(wrap, /max-height:\s*none/);
});

test("two axis boxes keep each swipe on one axis", () => {
  assert.match(rule(css, ".admin-table-wrap"), /overscroll-behavior-x:\s*contain/);
  assert.match(rule(css, ".admin-journal"), /overscroll-behavior-x:\s*contain/);
  assert.match(parts, /className="admin-table-wrap" ref=\{wrap\}/);
  assert.match(parts, /lockWheelAxis/);
});
