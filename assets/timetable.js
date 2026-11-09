/* 개설 강좌로 시간이 겹치지 않는 추천 시간표 만들기 */
(function (root) {
  "use strict";
  const DAYS = ["월", "화", "수", "목", "금", "토"];

  /** "화목09:00-10:30,금13:00-15:00" → [{d:1,s:540,e:630},{d:3,...},...] */
  function parseTime(t) {
    const out = [];
    String(t || "").split(/[,\s]+/).forEach((seg) => {
      const m = seg.match(/^([월화수목금토일]+)(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!m) return;
      const s = +m[2] * 60 + +m[3], e = +m[4] * 60 + +m[5];
      [...m[1]].forEach((ch) => { const d = DAYS.indexOf(ch); if (d >= 0) out.push({ d, s, e }); });
    });
    return out;
  }

  const clash = (a, b) => a.some((x) => b.some((y) => x.d === y.d && x.s < y.e && y.s < x.e));

  /**
   * cands: [{name, credit, weight, reason, kind}]  (앞에 있을수록 우선)
   * sectionsOf(name) → [{cl,p,t,d,cr}]
   * prefs: {cap, offDays:[0..4], noBefore:분, noAfter:분}
   * 반환: 최대 n개의 시간표 [{courses:[{...cand, sec, slots}], credits, score}]
   */
  function build(cands, sectionsOf, prefs, n) {
    const cap = prefs.cap || 18;
    const ok = (slots) => slots.every((x) => !(prefs.offDays || []).includes(x.d) && (!prefs.noBefore || x.s >= prefs.noBefore) && (!prefs.noAfter || x.e <= prefs.noAfter));
    const items = cands.map((c) => {
      const secs = (sectionsOf(c.name) || []).map((s) => ({ sec: s, slots: parseTime(s.t) })).filter((x) => ok(x.slots));
      return Object.assign({}, c, { secs });
    }).filter((c) => c.secs.length);
    const results = [];
    const seen = new Set();
    // 우선순위 순서대로 겹치지 않는 분반을 고르는 탐욕 배정을 분반 순서를 바꿔 가며 여러 번 시도
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let attempt = 0; attempt < 300; attempt++) {
      const chosen = [];
      let credits = 0;
      // 몇 번째 시도부터는 후순위 과목 순서도 조금 섞는다
      const order = attempt < 60 ? items : items.map((it, i) => ({ it, k: i + (i > 2 ? rnd() * 4 : 0) })).sort((a, b) => a.k - b.k).map((x) => x.it);
      for (const it of order) {
        const cr = it.credit || 3;
        if (credits + cr > cap) continue;
        const secs = attempt === 0 ? it.secs : it.secs.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.x);
        const s2 = secs.find((sv) => !chosen.some((c) => clash(c.slots, sv.slots)));
        if (!s2) continue;
        chosen.push(Object.assign({}, it, { sec: s2.sec, slots: s2.slots }));
        credits += cr;
      }
      if (!chosen.length) continue;
      const key = chosen.map((c) => c.name + c.sec.cl).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ courses: chosen, credits, score: chosen.reduce((s3, c) => s3 + c.weight, 0) });
    }
    // 점수(우선순위) → 학점 → 공강 많은 순
    const freeDays = (r) => 5 - new Set(r.courses.flatMap((c) => c.slots.map((x) => x.d))).size;
    results.sort((a, b) => b.score - a.score || b.credits - a.credits || freeDays(b) - freeDays(a));
    // 서로 다른 과목 구성이 먼저 보이도록
    const out = [], combos = new Set();
    for (const r of results) {
      const k = r.courses.map((c) => c.name).sort().join("|");
      if (combos.has(k) && out.length < (n || 3) - 1) continue;
      combos.add(k);
      out.push(r);
      if (out.length >= (n || 3)) break;
    }
    return out;
  }

  const api = { DAYS, parseTime, build, clash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TIMETABLE = api;
})(typeof self !== "undefined" ? self : this);
