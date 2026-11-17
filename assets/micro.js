/* 마이크로디그리 달성 여부 (data/micro.json, 수강편람 '마이크로디그리 이수 안내'·'AI 마이크로디그리 이수 안내') */
(function (root) {
  "use strict";
  const E = root.ABEEK || (typeof require !== "undefined" ? require("./engine.js") : null);

  const HOWTO = {
    general: {
      title: "마이크로디그리 신청",
      steps: [
        "과정의 지정 교과목을 모두(또는 과정이 정한 학점만큼) 이수합니다.",
        "재학 중에 세종대학교 두드림 시스템(do.sejong.ac.kr) → 포트폴리오 → 마이크로디그리에서 이수 신청합니다. 졸업 후에는 신청할 수 없습니다.",
        "최대 3개 과정까지 이수할 수 있고, 소속 전공 최소 이수학점은 따로 채워야 합니다(마이크로디그리만으로 졸업 불가).",
      ],
      link: "https://do.sejong.ac.kr/",
    },
    ai: {
      title: "AI 마이크로디그리 이수증 신청",
      steps: [
        "주관학과가 지정한 AI기초·AI심화·AI-X 과목을 10~12학점 이수합니다.",
        "‘택1’로 묶인 카테고리는 한 과목만 취득학점으로 인정됩니다.",
        "지정 교과목을 이수한 뒤 이수증을 신청합니다. 신청 기간·방법은 SW·AI혁신교육센터(swaiinno@sejong.ac.kr, 02-3408-1860) 공지를 확인하세요.",
      ],
      link: "mailto:swaiinno@sejong.ac.kr",
    },
  };

  function matches(taken, course) {
    const names = [course.name].concat(course.alias || []);
    return taken.find((t) => names.some((n) => E.same(t.name, n) || (E.renamed && E.renamed(t.name, n, null))));
  }

  /**
   * 한 과정의 진행 상황.
   * taken: 이수한 과목 [{name, credit}], planned: 들을 예정 과목 이름 목록
   */
  function evalProgram(p, taken, planned) {
    const done = [], left = [];
    const groups = {};
    p.courses.forEach((c) => {
      const t = matches(taken, c);
      const row = Object.assign({}, c, { taken: !!t, as: t && !E.same(t.name, c.name) ? t.name : "" });
      if (planned && !t) row.planned = planned.some((n) => E.same(n, c.name) || (c.alias || []).some((a) => E.same(n, a)));
      if (c.group) (groups[c.group] = groups[c.group] || []).push(row);
      else (t ? done : left).push(row);
    });
    let earned = done.reduce((s, c) => s + c.credit, 0);
    const groupState = Object.entries(groups).map(([id, rows]) => {
      const pick = rows[0].pick || 1;
      const got = rows.filter((r) => r.taken).sort((a, b) => b.credit - a.credit).slice(0, pick);
      earned += got.reduce((s, c) => s + c.credit, 0);
      return { id, label: rows[0].cat || "", pick, rows, got: got.length, ok: got.length >= pick };
    });
    groupState.forEach((g) => g.rows.forEach((r) => (r.taken ? done : left).push(Object.assign(r, { choice: `${g.label ? g.label + " " : ""}택${g.pick}` }))));
    let need, ok, remainCourses;
    if (p.rule === "all") {
      const reqLeft = left.filter((c) => !c.group);
      const grpLeft = groupState.filter((g) => !g.ok);
      ok = reqLeft.length === 0 && grpLeft.length === 0;
      need = p.courses.filter((c) => !c.group).reduce((s, c) => s + c.credit, 0)
        + groupState.reduce((s, g) => s + g.pick * Math.min(...g.rows.map((r) => r.credit)), 0);
      need = Math.max(need, p.credits || 0);
      remainCourses = reqLeft.length + grpLeft.reduce((s, g) => s + g.pick - g.got, 0);
    } else {
      need = p.credits || 12;
      ok = earned >= need;
      remainCourses = Math.max(0, Math.ceil((need - earned) / 3));
    }
    const remain = ok ? 0 : Math.max(0, need - earned);
    return { p, done, left, groups: groupState, earned: Math.min(earned, need), need, ok, remain, remainCourses };
  }

  /**
   * 전체 과정 평가. opts: {dept: [학과명], track, careerScore, offered: (name)=>bool, planned: [이름]}
   * 반환: { list:[결과], ok:[], near:[], mine:[], fit:[] }
   */
  function evaluate(data, courses, opts) {
    opts = opts || {};
    const taken = E.uniqueCourses(courses || []);
    const deptKeys = (opts.dept || []).map((d) => d.replace(/\s/g, "").replace(/(학과|전공|학부)$/, ""));
    const list = data.programs.map((p) => {
      const r = evalProgram(p, taken, opts.planned);
      const pd = (p.dept || p.contact || "").replace(/\s/g, "");
      r.mine = deptKeys.some((d) => d && pd.startsWith(d));
      // AI 마이크로디그리는 공통 AI기초·AI심화 과목이 겹치므로 학과별 AI-X 과목으로만 진로 적합도를 본다
      const core = p.kind === "ai" ? p.courses.filter((c) => !/^AI(기초|심화)/.test(c.cat || "")) : p.courses;
      r.fit = opts.track && opts.careerScore && core.length ? core.reduce((s, c) => s + opts.careerScore(opts.track, c.name), 0) / core.length : 0;
      if (opts.offered) r.left.forEach((c) => (c.offered = opts.offered(c.name) || (c.alias || []).some(opts.offered)));
      return r;
    });
    const started = (r) => r.earned > 0;
    const byRemain = (a, b) => a.remain - b.remain || b.fit - a.fit || b.earned - a.earned;
    const ok = list.filter((r) => r.ok).sort((a, b) => b.fit - a.fit);
    const near = list.filter((r) => !r.ok && started(r) && r.remain <= 6).sort(byRemain);
    const mine = list.filter((r) => r.mine && !r.ok && !near.includes(r)).sort(byRemain);
    const fit = list.filter((r) => !r.ok && !near.includes(r) && !mine.includes(r) && r.fit > 0).sort((a, b) => (a.p.kind === "ai") - (b.p.kind === "ai") || b.fit - a.fit || byRemain(a, b)).slice(0, 4); // 다른 학과 AI 마이크로디그리는 뒤로
    return { list, ok, near, mine, fit };
  }

  const api = { evaluate, evalProgram, HOWTO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MICRO = api;
})(typeof self !== "undefined" ? self : this);
