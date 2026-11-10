#!/usr/bin/env node
// Unit tests for merge() in site/sync.js: node tools/sync-test.js
const assert = require("assert");
const { merge, same, without, summary, levelOf } = require("../site/sync.js");
const base = (o) => Object.assign({ v: 1, answers: {}, review: {}, reported: [], session: null, days: {}, prefs: {}, mock: {}, cards: {}, cardDays: {}, at: 0 }, o);
const ans = (t, ok, c = 1) => ({ t, c, ok, ms: 1000, g: false, rev: 1 });
let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok", name); };

test("nothing on the server keeps the local state", () => {
  const a = base({ answers: { q1: [ans(10, true)] } });
  assert.strictEqual(merge(a, null), a);
});

test("answers from both devices are kept in time order, last five", () => {
  const a = base({ answers: { q1: [ans(1, false), ans(3, true), ans(5, true)], q2: [ans(2, true)] }, at: 5000 });
  const b = base({ answers: { q1: [ans(2, false), ans(4, true), ans(6, true), ans(7, true)], q3: [ans(9, false)] }, at: 7000 });
  const m = merge(a, b);
  assert.deepStrictEqual(m.answers.q1.map((r) => r.t), [3, 4, 5, 6, 7]);
  assert.strictEqual(m.answers.q2.length, 1);
  assert.strictEqual(m.answers.q3.length, 1);
});

test("the same answer synced earlier is not doubled", () => {
  const a = base({ answers: { q1: [ans(1, false), ans(2, true)] } }), b = base({ answers: { q1: [ans(1, false)] } });
  assert.strictEqual(merge(a, b).answers.q1.length, 2);
});

test("review list follows whoever answered the question last", () => {
  // The phone got q1 wrong at t=1; the laptop answered it right later and it left the list.
  const phone = base({ answers: { q1: [ans(1, false)] }, review: { q1: { lv: 0, due: 1, src: "bank" } }, at: 1000 });
  const laptop = base({ answers: { q1: [ans(1, false), ans(9, true)] }, review: {}, at: 9000 });
  assert.deepStrictEqual(merge(phone, laptop).review, {});
  assert.deepStrictEqual(merge(laptop, phone).review, {});
  // The other way round: wrong later on the laptop → on the list everywhere.
  const laptop2 = base({ answers: { q1: [ans(1, true), ans(9, false)] }, review: { q1: { lv: 0, due: 9, src: "bank" } }, at: 9000 });
  const phone2 = base({ answers: { q1: [ans(1, true)] }, review: {}, at: 1000 });
  assert.ok(merge(phone2, laptop2).review.q1);
  assert.ok(merge(laptop2, phone2).review.q1);
});

test("review tie: removal on the side changed last wins", () => {
  const old = base({ answers: { q1: [ans(1, false)] }, review: { q1: { lv: 0, due: 1, src: "bank" } }, at: 1000 });
  const removed = base({ answers: { q1: [ans(1, false)] }, review: {}, at: 2000 });
  assert.deepStrictEqual(merge(old, removed).review, {});
  assert.deepStrictEqual(merge(removed, old).review, {});
});

test("days take the larger count, not the sum", () => {
  const m = merge(base({ days: { "2026-11-09": 12, "2026-11-10": 3 } }), base({ days: { "2026-11-09": 12, "2026-11-08": 7 } }));
  assert.deepStrictEqual(m.days, { "2026-11-09": 12, "2026-11-10": 3, "2026-11-08": 7 });
});

test("days count both devices when each answered different questions that day", () => {
  const t0 = Math.floor(new Date(2026, 10, 10, 12).getTime() / 1000);
  const a = base({ answers: { q1: [ans(t0, true)], q2: [ans(t0 + 1, true)] }, days: { "2026-11-10": 2 } });
  const b = base({ answers: { q3: [ans(t0 + 2, true)], q4: [ans(t0 + 3, true)], q5: [ans(t0 + 4, false)] }, days: { "2026-11-10": 3 } });
  assert.strictEqual(merge(a, b).days["2026-11-10"], 5);
  assert.strictEqual(merge(merge(a, b), b).days["2026-11-10"], 5);
});

test("mock: every attempt once, in order; a submitted attempt is no longer in progress", () => {
  const a = base({ mock: { "n4-mock-1": { current: { start: 300, answers: { x: { c: 1 } } }, attempts: [{ start: 100, total: 40 }] } } });
  const b = base({ mock: { "n4-mock-1": { current: null, attempts: [{ start: 100, total: 40 }, { start: 300, total: 55 }] }, "n4-mock-2": { current: { start: 500 }, attempts: [] } } });
  const m = merge(a, b);
  assert.deepStrictEqual(m.mock["n4-mock-1"].attempts.map((t) => t.start), [100, 300]);
  assert.strictEqual(m.mock["n4-mock-1"].current, null);
  assert.strictEqual(m.mock["n4-mock-2"].current.start, 500);
});

test("mock: of two unfinished attempts the later one stays; the local copy of the same one wins", () => {
  const a = base({ mock: { s: { current: { start: 300, at: 7 }, attempts: [] } } }), b = base({ mock: { s: { current: { start: 200 }, attempts: [] } } });
  assert.strictEqual(merge(a, b).mock.s.current.start, 300);
  assert.strictEqual(merge(b, a).mock.s.current.start, 300);
  const c = base({ mock: { s: { current: { start: 300, at: 2 }, attempts: [] } } });
  assert.strictEqual(merge(a, c).mock.s.current.at, 7);
});

test("cards: the copy graded most recently", () => {
  const a = base({ cards: { k1: { s: "review", ivl: 4, t: 100 }, k2: { s: "learn", step: 0, t: 50 } }, cardDays: { d: { n: 3, r: 1 } } });
  const b = base({ cards: { k1: { s: "review", ivl: 9, t: 200 }, k3: { s: "learn", step: 1, t: 10 } }, cardDays: { d: { n: 2, r: 5 } } });
  const m = merge(a, b);
  assert.strictEqual(m.cards.k1.ivl, 9);
  assert.ok(m.cards.k2 && m.cards.k3);
  assert.deepStrictEqual(m.cardDays.d, { n: 3, r: 5 });
});

test("session stays this browser's; reported is the union; prefs from the newer side", () => {
  const a = base({ session: { ids: ["q1"] }, reported: ["q1"], prefs: { rate: 1, size: 10 }, at: 1000 });
  const b = base({ session: { ids: ["q9"] }, reported: ["q1", "q2"], prefs: { rate: 1.25 }, at: 2000 });
  const m = merge(a, b);
  assert.deepStrictEqual(m.session, { ids: ["q1"] });
  assert.deepStrictEqual(m.reported.sort(), ["q1", "q2"]);
  assert.deepStrictEqual(m.prefs, { rate: 1.25, size: 10 });
  assert.strictEqual(m.at, 2000);
});

test("merging is stable: merging the result with either input again changes nothing", () => {
  const a = base({ answers: { q1: [ans(1, false), ans(5, true)], q2: [ans(2, false)] }, review: { q2: { lv: 0, due: 2, src: "bank" } }, days: { d1: 2 }, cards: { k: { t: 5, ivl: 1 } }, mock: { s: { current: { start: 9 }, attempts: [{ start: 3 }] } }, at: 5000 });
  const b = base({ answers: { q1: [ans(1, false), ans(7, false)], q3: [ans(4, true)] }, review: { q1: { lv: 0, due: 7, src: "bank" } }, days: { d1: 1, d2: 4 }, cards: { k: { t: 8, ivl: 3 } }, mock: { s: { current: null, attempts: [{ start: 3 }, { start: 6 }] } }, at: 7000 });
  const m = merge(a, b);
  assert.ok(same(merge(m, b), m));
  assert.ok(same(merge(m, a), m));
  assert.ok(same(merge(b, a), m) || merge(b, a).session !== m.session);
  assert.ok(same(merge(a, b), merge(b, a)));
});

test("fields a newer quiz.js adds survive", () => {
  const m = merge(base({ extra: { x: 1 }, at: 2 }), base({ at: 1 }));
  assert.deepStrictEqual(m.extra, { x: 1 });
});

test("a higher epoch replaces the other copy whole (clear, restore, import)", () => {
  const cleared = base({ epoch: 1, answers: { q9: [ans(50, true)] }, at: 9000 });
  const stale = base({ answers: { q1: [ans(1, false)], q2: [ans(2, true)] }, review: { q1: { lv: 0, due: 1 } }, session: { ids: ["q1"] }, at: 99000 });
  let m = merge(stale, cleared);                     // another device that still has the old progress
  assert.deepStrictEqual(Object.keys(m.answers), ["q9"]);
  assert.deepStrictEqual(m.review, {});
  assert.strictEqual(m.epoch, 1);
  assert.deepStrictEqual(m.session, { ids: ["q1"] }, "the device keeps its own unfinished set");
  m = merge(cleared, stale);                         // the device that cleared, against an old server copy
  assert.deepStrictEqual(Object.keys(m.answers), ["q9"]);
  // Same epoch again: back to merging.
  const later = base({ epoch: 1, answers: { q9: [ans(50, true)], q10: [ans(60, true)] }, at: 9500 });
  assert.deepStrictEqual(Object.keys(merge(cleared, later).answers).sort(), ["q10", "q9"]);
});

test("levels: questions and mock sets by id prefix, cards by lesson number", () => {
  assert.strictEqual(levelOf("n5-l15-012"), "n5");
  assert.strictEqual(levelOf("n2-mock-2"), "n2");
  assert.strictEqual(levelOf("18:使役形"), "n4");
  assert.strictEqual(levelOf("17:x|c"), "n5");
  assert.strictEqual(levelOf("76:y"), "n1");
  assert.strictEqual(levelOf("0:z"), "n5");
  assert.strictEqual(levelOf("weird"), "");
});

test("clearing one level leaves the others, the settings and the day counts", () => {
  const s = base({ answers: { "n5-l01-001": [ans(1, true)], "n4-mg-101": [ans(2, false)] }, review: { "n4-mg-101": { lv: 0, due: 2 } },
    mock: { "n5-mock-1": { current: null, attempts: [{ start: 5 }] }, "n4-mock-1": { current: { start: 9 }, attempts: [] } },
    cards: { "3:は": { t: 1 }, "20:あげる": { t: 2 }, "20:あげる|c": { t: 3 } }, days: { d: 2 }, prefs: { size: 10 }, reported: ["n4-x"] });
  const m = without(s, "n4");
  assert.deepStrictEqual(Object.keys(m.answers), ["n5-l01-001"]);
  assert.deepStrictEqual(m.review, {});
  assert.deepStrictEqual(Object.keys(m.mock), ["n5-mock-1"]);
  assert.deepStrictEqual(Object.keys(m.cards), ["3:は"]);
  assert.deepStrictEqual(m.days, { d: 2 });
  assert.deepStrictEqual(m.prefs, { size: 10 });
  assert.strictEqual(Object.keys(s.answers).length, 2, "the original is not changed");
  const all = without(s, "all");
  assert.deepStrictEqual([all.answers, all.review, all.mock, all.cards, all.days], [{}, {}, {}, {}, {}]);
  assert.deepStrictEqual(all.prefs, { size: 10 });
  assert.deepStrictEqual(all.reported, ["n4-x"]);
  const sum = summary(s);
  assert.deepStrictEqual(sum.levels.n4, { answers: 1, review: 1, mocks: 0, cards: 2 });
  assert.deepStrictEqual(sum.levels.n5, { answers: 1, review: 0, mocks: 1, cards: 1 });
  assert.strictEqual(sum.days, 1);
});

console.log(n + " tests passed");
