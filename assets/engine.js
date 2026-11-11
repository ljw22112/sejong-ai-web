/* 공학인증 판정·추천 엔진 (브라우저/Node 공용, 외부 의존성 없음) */
(function (root) {
  "use strict";

  // ---------- 과목명 정규화 ----------
  // 표기만 다른 같은 과목 (확실한 것)
  const ALIASES = [
    ["선형대수", "선형대수학"],
    ["확률및통계", "확률과통계"],
    ["capstone디자인", "캡스톤디자인", "capstone디자인산학협력프로젝트"],
  ];
  function nkey(s) {
    return String(s || "")
      .replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").replace(/Ⅲ/g, "3")
      .replace(/[\s·ㆍ:：\-_,.'"‘’“”\[\]]/g, "")
      .toLowerCase();
  }
  const ALIAS_OF = {};
  ALIASES.forEach((g) => { const c = nkey(g[0]); g.forEach((n) => (ALIAS_OF[nkey(n)] = c)); });
  function keys(name) {
    const full = nkey(name);
    const base = full.replace(/\([^)]*\)/g, "");
    const out = new Set([full, base]);
    [full, base].forEach((k) => { if (ALIAS_OF[k]) out.add(ALIAS_OF[k]); });
    return out;
  }
  function same(a, b) {
    const ka = keys(a);
    for (const k of keys(b)) if (k && ka.has(k)) return true;
    return false;
  }
  // ---------- 이름 바뀐 과목 (data/renames.json) ----------
  let GROUPS = [];
  const TYPE_ORDER = { same: 0, sub: 1, probable: 2 };
  function setRenames(data) {
    GROUPS = [];
    ((data && data.groups) || []).forEach((g) => {
      if (g.type === "notation") {
        const c = ALIAS_OF[nkey(g.names[0])] || nkey(g.names[0]);
        g.names.forEach((n) => (ALIAS_OF[nkey(n)] = c));
      } else GROUPS.push(g);
    });
    GROUPS.sort((x, y) => (TYPE_ORDER[x.type] ?? 9) - (TYPE_ORDER[y.type] ?? 9));
  }
  /** a 와 b 가 같은 과목으로 지정·추정된 묶음이면 그 묶음을 돌려준다 */
  function renamed(a, b, pid) {
    for (const g of GROUPS) {
      if (g.programs && pid && !g.programs.includes(pid)) continue;
      if (g.programs && !pid) continue;
      const ia = g.names.findIndex((n) => same(n, a)), ib = g.names.findIndex((n) => same(n, b));
      if (ia >= 0 && ib >= 0 && ia !== ib) return g;
    }
    return null;
  }
  function inList(name, list) { return (list || []).some((x) => same(name, x)); }
  function findIn(name, list) { return (list || []).find((x) => same(name, x)); }

  // ---------- 성적 ----------
  const FAIL = /^(F|NP|U|W|FA|N)$/i;
  function passed(c) { return !c.grade || !FAIL.test(String(c.grade).trim()); }
  function termOrder(t) {
    if (!t) return null;
    const m = String(t).match(/(\d{4})\D*([12]|하계|동계|여름|겨울|S|W)/);
    if (!m) return null;
    const s = { 1: 1, 하계: 1.5, 여름: 1.5, S: 1.5, 2: 2, 동계: 2.5, 겨울: 2.5, W: 2.5 }[m[2]];
    return Number(m[1]) * 10 + s * 2;
  }

  // 재수강: 같은 과목은 통과한 마지막 기록 하나만
  function uniqueCourses(courses) {
    const map = new Map();
    courses.filter(passed).forEach((c) => {
      const k = nkey(c.name).replace(/\([^)]*\)/g, "") || c.name;
      const prev = map.get(k);
      if (!prev || (termOrder(c.term) || 0) >= (termOrder(prev.term) || 0)) map.set(k, c);
    });
    return [...map.values()];
  }

  // ---------- 영역 분류 ----------
  function catalogEntry(rule, name) {
    return (rule.catalog || []).find((c) => same(c.name, name));
  }
  function designCredit(rule, name) {
    const dc = rule.designCredits || {};
    for (const k of Object.keys(dc)) if (same(k, name)) return dc[k];
    const e = catalogEntry(rule, name);
    if (e && e.design) return e.design;
    // 표에 설계학점이 없을 때: 지정 설계과목의 일반적인 배정
    const d = rule.design || {};
    if (inList(name, d.basic) || inList(name, d.capstone)) return 3;
    if (inList(name, d.element)) return 1;
    return 0;
  }
  function isDesignListed(rule, name) {
    const d = rule.design || {};
    return inList(name, d.basic) || inList(name, d.element) || inList(name, d.capstone) || designCredit(rule, name) > 0;
  }
  function classify(rule, c) {
    if (c.area) return { area: c.area, how: "직접 지정" };
    const ge = rule.ge || {}, msc = rule.msc || {};
    if (inList(c.name, ge.required) || inList(c.name, ge.electives)) return { area: "GE", how: "인증 전문교양 목록" };
    if (inList(c.name, msc.required) || inList(c.name, msc.electives)) return { area: "MSC", how: "인증 MSC/BSM 목록" };
    const e = catalogEntry(rule, c.name);
    if (e && e.area) return { area: e.area, how: "입학자 교과과정표" };
    if (isDesignListed(rule, c.name) || inList(c.name, (rule.major || {}).required)) return { area: "MAJOR", how: "설계·필수 목록" };
    if (/전필|전선|전공|전기/.test(c.cat || "")) return { area: "MAJOR", how: "성적표 이수구분(추정)", guess: true };
    return { area: "OTHER", how: "인증 영역 아님" };
  }

  // ---------- 판정 ----------
  function ruleNames(rule) {
    if (rule._names) return rule._names;
    const d = rule.design || {};
    const out = [];
    [(rule.ge || {}).required, (rule.ge || {}).electives, (rule.msc || {}).required, (rule.msc || {}).electives,
      (rule.major || {}).required, d.basic, d.element, d.capstone].forEach((l) => (l || []).forEach((n) => out.push(n)));
    (rule.catalog || []).forEach((c) => out.push(c.name));
    Object.defineProperty(rule, "_names", { value: out, enumerable: false });
    return out;
  }
  /** 이 학번 요건에 없는 과목명이 '이름만 바뀐 과목'이면 이 학번의 과목명으로 바꿔 판정한다 */
  function mapRenamed(rule, c) {
    const names = ruleNames(rule);
    if (names.some((n) => same(c.name, n))) return c;
    for (const n of names) {
      const g = renamed(c.name, n, rule.pid);
      if (g) return Object.assign({}, c, { name: n, origName: c.name, renamed: true, renameType: g.type, renameNote: g.note || "" });
    }
    // 글자 인식으로 앞뒤가 잘린 과목명: 이 학번 과목 중 하나에만 통째로 들어 있으면 그 과목
    const k = nkey(c.name);
    if (c.ocr && k.length >= 5) {
      // 잘린 부분이 이 학번 과목명 어딘가와 거의 같으면(글자 1~2개 오인식 허용) 그 과목
      const lev = (a, b) => {
        const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) d[0][j] = j;
        for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        return d[a.length][b.length];
      };
      const tol = Math.max(1, Math.floor(k.length * 0.2));
      const scored = [...new Set(names)].map((n) => {
        const nk = nkey(n);
        if (nk.length < k.length || k.length < 0.5 * nk.length) return null;
        let best = 99;
        for (let i = 0; i + k.length <= nk.length; i++) best = Math.min(best, lev(k, nk.slice(i, i + k.length)));
        return best <= tol ? { n, best } : null;
      }).filter(Boolean).sort((a, b) => a.best - b.best);
      if (scored.length && (scored.length === 1 || scored[0].best < scored[1].best))
        return Object.assign({}, c, { name: scored[0].n, origName: c.name, ocrFixed: true });
    }
    return c;
  }

  function evaluate(rule, rawCourses) {
    const courses = uniqueCourses(rawCourses).map((c) => mapRenamed(rule, c)).map((c) => Object.assign({}, c, classify(rule, c)));
    const by = (a) => courses.filter((c) => c.area === a);
    const sum = (arr, f) => arr.reduce((s, c) => s + (Number(f ? f(c) : c.credit) || 0), 0);
    const has = (name) => courses.find((c) => same(c.name, name));
    const checks = [];
    const push = (group, label, ok, detail, missing) => checks.push({ group, label, ok, detail, missing: missing || [] });

    // 전문교양
    const ge = rule.ge || {};
    (ge.required || []).forEach((n) => push("GE", n, !!has(n), "인증필수", has(n) ? [] : [n]));
    if (ge.pickN) {
      const got = (ge.electives || []).filter(has);
      push("GE", `인증선택 ${ge.pickN}과목 이상`, got.length >= ge.pickN,
        got.length ? `이수: ${got.join(", ")}` : "아직 없음",
        got.length >= ge.pickN ? [] : (ge.electives || []).filter((n) => !has(n)));
    }
    // MSC
    const msc = rule.msc || {};
    (msc.required || []).forEach((n) => push("MSC", n, !!has(n), "인증필수", has(n) ? [] : [n]));
    if (msc.electiveAtLeastOne && (msc.electives || []).length) {
      const got = msc.electives.filter(has);
      push("MSC", `인증선택 1과목 이상 (${msc.electives.join(", ")})`, got.length > 0, got.join(", ") || "아직 없음", got.length ? [] : msc.electives);
    }
    // 전공 필수
    const major = rule.major || {};
    (major.required || []).forEach((n) => push("MAJOR", n, !!has(n), "인증필수", has(n) ? [] : [n]));

    // 설계: 기초 → 요소 → 종합 순서
    const d = rule.design || {};
    const basicTaken = courses.filter((c) => inList(c.name, d.basic));
    const capTaken = courses.filter((c) => inList(c.name, d.capstone));
    const tBasic = Math.min(...basicTaken.map((c) => termOrder(c.term) ?? Infinity), Infinity);
    const tCap = Math.max(...capTaken.map((c) => termOrder(c.term) ?? -Infinity), -Infinity);
    const designRows = [];
    courses.filter((c) => c.area === "MAJOR").forEach((c) => {
      const dc = designCredit(rule, c.name);
      if (!dc) return;
      const t = termOrder(c.term);
      let counted = true, why = "";
      const isB = inList(c.name, d.basic), isC = inList(c.name, d.capstone);
      if (!isB && !isC && t != null) {
        if (isFinite(tBasic) && t < tBasic) { counted = false; why = "기초설계 이전 수강"; }
        else if (!isFinite(tBasic)) { counted = false; why = "기초설계 미이수"; }
        if (isFinite(tCap) && t > tCap) { counted = false; why = "종합설계 이후 수강"; }
      }
      if (isC && t != null && isFinite(tBasic) && t < tBasic) { counted = false; why = "기초설계 이전 수강"; }
      designRows.push({ name: c.name, design: dc, counted, why, term: c.term });
    });
    if (d.capstoneAnyOf && capTaken.length > 1) {
      // 둘 다 들으면 하나만 인정
      let first = true;
      designRows.forEach((r) => { if (inList(r.name, d.capstone)) { if (!first && r.counted) { r.counted = false; r.why = "종합설계 중복(1과목만 인정)"; } first = false; } });
    }
    const designEarned = designRows.filter((r) => r.counted).reduce((s, r) => s + r.design, 0);
    if ((d.basic || []).length) push("DESIGN", `기초설계 (${d.basic.join(" / ")})`, basicTaken.length > 0, basicTaken.map((c) => c.name).join(", ") || "미이수", basicTaken.length ? [] : [d.basic[0]]);
    if ((d.capstone || []).length) {
      if (d.capstoneAnyOf) push("DESIGN", `종합설계 택1 (${d.capstone.join(" / ")})`, capTaken.length > 0, capTaken.map((c) => c.name).join(", ") || "미이수", capTaken.length ? [] : [d.capstone[0]]);
      else d.capstone.forEach((n) => { if (!inList(n, major.required)) push("DESIGN", `종합설계 ${n}`, !!has(n), has(n) ? "이수" : "미이수", has(n) ? [] : [n]); });
    }

    // 종합설계를 듣는 학기까지 기초·요소설계 학점이 다 차 있어야 한다 (공학교육센터 안내)
    const firstCap = capTaken.map((c) => termOrder(c.term)).filter((t) => t != null).sort((a, b) => a - b)[0];
    if (firstCap != null && major.designMin) {
      const capCr = Math.max(...capTaken.map((c) => designCredit(rule, c.name)), 3);
      const before = designRows.filter((r) => r.counted && !inList(r.name, d.capstone) && termOrder(r.term) != null && termOrder(r.term) <= firstCap).reduce((s, r) => s + r.design, 0);
      const needBefore = major.designMin - capCr;
      if (needBefore > 0) push("DESIGN", "종합설계 수강 학기까지 기초·요소설계 학점 확보", before >= needBefore,
        `종합설계 학기까지 ${before}/${needBefore}학점${before >= needBefore ? "" : " · 이대로면 설계학점 전체가 인정되지 않을 수 있음"}`, []);
    }

    // 추가 조건
    (rule.extra || []).forEach((x) => {
      const got = courses.filter((c) => inList(c.name, x.courses));
      if (x.minCount) push("EXTRA", x.label, got.length >= x.minCount, `${got.length}/${x.minCount}과목`, got.length >= x.minCount ? [] : x.courses.filter((n) => !has(n)));
      if (x.minCredits) { const cr = sum(got); push("EXTRA", x.label, cr >= x.minCredits, `${cr}/${x.minCredits}학점`, cr >= x.minCredits ? [] : x.courses.filter((n) => !has(n))); }
    });

    const areas = [
      { id: "GE", label: "전문교양", min: ge.min || 0, earned: sum(by("GE")) },
      { id: "MSC", label: "MSC(BSM)", min: msc.min || 0, earned: sum(by("MSC")) },
      { id: "MAJOR", label: "전공", min: major.min || 0, earned: sum(by("MAJOR")) },
      { id: "DESIGN", label: "설계", min: major.designMin || 0, earned: designEarned },
    ];
    areas.forEach((a) => (a.ok = a.earned >= a.min));
    const ok = areas.every((a) => a.ok) && checks.every((c) => c.ok);
    const renamedList = courses.filter((c) => c.renamed).map((c) => ({ from: c.origName, to: c.name, type: c.renameType, note: c.renameNote }));
    return { ok, areas, checks, courses, designRows, renamed: renamedList };
  }

  // ---------- 진로 추천 ----------
  function careerScore(track, name) {
    if (!track) return 0;
    let s = 0;
    (track.keywords || []).forEach((k) => { if (new RegExp(k, "i").test(name)) s += 3; });
    (track.related || []).forEach((k) => { if (new RegExp(k, "i").test(name)) s += 1; });
    if (s && /K-?MOOC/i.test(name)) s -= 1; // 정규 개설과목을 먼저
    return s;
  }

  /**
   * opts: { track, nextYear(1~4), nextSem(1|2), cap(학기당 인증과목 학점), extraPicks }
   * 반환: { semesters:[{label, year, sem, courses:[...]}], unplaced:[], picks:[] }
   */
  function recommend(rule, result, opts) {
    const track = opts.track;
    const takenHas = (n) => result.courses.some((c) => same(c.name, n));
    const chosen = [];
    const isChosen = (n) => chosen.some((c) => same(c.name, n));
    const catalog = [];
    (rule.catalog || []).forEach((c) => { if (!catalog.some((x) => same(x.name, c.name))) catalog.push(c); });
    const info = (n) => catalog.find((c) => same(c.name, n)) || { name: n, credit: 3, design: designCredit(rule, n), area: null };
    const excluded = (n) => inList(n, opts.exclude || []);
    const add = (n, reason, kind) => {
      if (takenHas(n) || isChosen(n) || excluded(n)) return false;
      const e = info(n);
      const area = e.area || (inList(n, (rule.msc || {}).required) || inList(n, (rule.msc || {}).electives) ? "MSC" : inList(n, (rule.ge || {}).electives) || inList(n, (rule.ge || {}).required) ? "GE" : "MAJOR");
      chosen.push({ name: e.name || n, credit: e.credit || 3, design: designCredit(rule, n), year: e.year, sem: e.sem, area, reason, kind, fit: careerScore(track, n) });
      return true;
    };
    const need = {};
    result.areas.forEach((a) => (need[a.id] = Math.max(0, a.min - a.earned)));
    const d = rule.design || {};

    // 1) 미충족 필수 조건
    result.checks.filter((c) => !c.ok).forEach((c) => {
      if (/인증선택|택1|이상/.test(c.label) && c.missing.length > 1) {
        const pickN = c.group === "GE" ? Math.max(1, (rule.ge.pickN || 1) - (rule.ge.electives || []).filter(takenHas).length) : 1;
        const order = [...c.missing].sort((a, b) => careerScore(track, b) - careerScore(track, a));
        order.slice(0, pickN).forEach((n) => add(n, c.label, "required"));
      } else c.missing.forEach((n) => add(n, c.group === "EXTRA" ? c.label : "인증필수", "required"));
    });
    const chosenSum = (area, f) => chosen.filter((c) => !area || c.area === area).reduce((s, c) => s + (f ? f(c) : c.credit), 0);

    // 2) 설계학점 부족분: 진로에 맞는 요소설계부터
    const designNeed = () => need.DESIGN - chosenSum(null, (c) => c.design || 0);
    if (designNeed() > 0) {
      const pool = catalog.filter((c) => c.area === "MAJOR" && designCredit(rule, c.name) > 0 && !inList(c.name, d.basic) && !inList(c.name, d.capstone));
      (d.element || []).forEach((n) => { if (!pool.some((p) => same(p.name, n))) pool.push(info(n)); });
      pool.sort((a, b) => careerScore(track, b.name) - careerScore(track, a.name) || (a.year || 9) - (b.year || 9));
      for (const p of pool) { if (designNeed() <= 0) break; add(p.name, "설계학점 보충", "design"); }
    }
    // 3) MSC 부족분
    if (need.MSC - chosenSum("MSC") > 0) {
      const pool = [...(rule.msc.electives || [])].concat(catalog.filter((c) => c.area === "MSC").map((c) => c.name));
      for (const n of pool) { if (need.MSC - chosenSum("MSC") <= 0) break; add(n, "MSC 학점 보충", "fill"); }
    }
    // 4) 전공 부족분: 진로 적합도 순
    if (need.MAJOR - chosenSum("MAJOR") > 0) {
      const pool = catalog.filter((c) => c.area === "MAJOR").sort((a, b) => careerScore(track, b.name) - careerScore(track, a.name) || (a.year || 9) - (b.year || 9));
      for (const p of pool) { if (need.MAJOR - chosenSum("MAJOR") <= 0) break; add(p.name, careerScore(track, p.name) ? "전공 학점 보충 · 진로 적합" : "전공 학점 보충", "fill"); }
    }
    // 5) 진로 심화(선택): 요건은 채웠어도 들으면 좋은 과목
    const picks = catalog
      .filter((c) => c.area === "MAJOR" && !takenHas(c.name) && !isChosen(c.name) && !excluded(c.name) && careerScore(track, c.name) > 0)
      .sort((a, b) => careerScore(track, b.name) - careerScore(track, a.name))
      .slice(0, opts.extraPicks ?? 6)
      .map((c) => ({ name: c.name, credit: c.credit, design: designCredit(rule, c.name), year: c.year, sem: c.sem, fit: careerScore(track, c.name) }));

    // ---------- 학기 배치 ----------
    const sems = [];
    let y = opts.nextYear || 1, s = opts.nextSem || 1;
    for (let i = 0; i < 10; i++) {
      sems.push({ year: y, sem: s, label: y <= 4 ? `${y}학년 ${s}학기` : `추가 ${s}학기`, courses: [] });
      if (s === 1) s = 2; else { s = 1; y++; }
    }
    const cap = opts.cap || 15;
    const pre = opts.preload || {};
    const load = (sm) => sm.courses.reduce((a, c) => a + c.credit, 0) + (pre[`${sm.year}-${sm.sem}`] || 0);
    const kindRank = (c) => (inList(c.name, d.basic) ? 0 : inList(c.name, d.capstone) ? 9 : c.kind === "required" ? 1 : c.kind === "design" ? 2 : 3);
    const order = [...chosen].sort((a, b) => kindRank(a) - kindRank(b) || (a.year || 0) - (b.year || 0) || (a.sem || 0) - (b.sem || 0));
    let basicIdx = result.checks.some((c) => c.group === "DESIGN" && /기초설계/.test(c.label) && c.ok) ? -1 : null;
    const unplaced = [];
    order.forEach((c) => {
      const isCap = inList(c.name, d.capstone), isBasic = inList(c.name, d.basic), isDesign = c.design > 0;
      let idx = sems.findIndex((sm, i) => {
        if (c.sem && sm.sem !== c.sem) return false; // 개설 학기
        if (c.year && sm.year < c.year && sm.year <= 4) return false; // 권장 학년 이전은 피함
        if (isDesign && !isBasic && basicIdx === null) return false;
        if (isDesign && !isBasic && basicIdx != null && i < basicIdx) return false; // 기초설계와 병수는 허용
        if (load(sm) + c.credit > cap) return false;
        return true;
      });
      if (isCap) {
        // 종합설계는 마지막 쪽에: 요소설계 배치 이후, 4학년 우선
        const lastDesign = Math.max(-1, ...sems.map((sm, i) => (sm.courses.some((x) => x.design > 0 && !inList(x.name, d.basic)) ? i : -1)));
        idx = sems.findIndex((sm, i) => i >= lastDesign && (!c.sem || sm.sem === c.sem) && (sm.year >= 4 || i === sems.length - 1) && load(sm) + c.credit <= cap);
        if (idx < 0) idx = sems.findIndex((sm, i) => i >= lastDesign && load(sm) + c.credit <= cap);
      }
      if (idx < 0) idx = sems.findIndex((sm) => load(sm) + c.credit <= cap);
      if (idx < 0) { unplaced.push(c); return; }
      sems[idx].courses.push(c);
      if (isBasic && (basicIdx === null || idx < basicIdx)) basicIdx = idx;
    });
    while (sems.length && !sems[sems.length - 1].courses.length) sems.pop();
    // 교과과정표만으로 채우지 못한 학점
    const gaps = result.areas.map((a) => {
      const add = a.id === "DESIGN" ? chosenSum(null, (c) => c.design || 0) : chosenSum(a.id);
      return { id: a.id, label: a.label, left: Math.max(0, Math.round((a.min - a.earned - add) * 10) / 10) };
    }).filter((g) => g.left > 0);
    return { semesters: sems, unplaced, picks, chosen, gaps };
  }

  const api = { setRenames, renamed, mapRenamed, nkey, keys, same, inList, findIn, evaluate, recommend, classify, uniqueCourses, termOrder, careerScore, designCredit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ABEEK = api;
})(typeof self !== "undefined" ? self : this);
