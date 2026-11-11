/* 학과 졸업요건 판정, 공학인증 유지·포기 비교 */
(function (root) {
  "use strict";
  const E = root.ABEEK || (typeof require !== "undefined" ? require("./engine.js") : null);

  // 인증 프로그램 → 연도별 교과과정 표의 학과명 후보 (앞에 있을수록 우선)
  const DEPT = {
    "03": ["컴퓨터공학과"],
    "05": ["소프트웨어학과", "콘텐츠소프트웨어학과"],
    "06": ["정보보호학과"],
    "16": ["데이터사이언스학과", "인공지능데이터사이언스학과"],
    "18": ["인공지능학과", "인공지능데이터사이언스학과"],
    "17": ["AI로봇학과", "지능기전공학과", "지능기전공학부", "무인이동체공학전공", "스마트기기공학전공"],
    "19": ["전자정보통신공학과", "AI융합전자공학과"],
    "07": ["건축공학과", "건축공학전공"],
    "08": ["건설환경공학과"],
    "10": ["환경에너지공간융합학과", "환경융합공학과"],
    "11": ["지구자원시스템공학과", "에너지자원공학과"],
    "12": ["양자원자력공학과", "원자력공학과"],
    "13": ["기계공학과", "기계공학전공"],
    "14": ["우주항공공학전공", "항공우주공학전공"],
    "15": ["나노신소재공학과"],
  };
  const COMMON_ALIAS = [["대학생활과진로설계", "대학생활과진로탐색"], ["창업과기업가정신1", "창업가기업가정신1"]];

  const catOf = (c) => String(c.cat || "").replace(/\s+/g, "");
  const is = {
    common: (c) => /^(공필|교필|공통필수|교양필수|공통교양)/.test(catOf(c)),
    balance: (c) => /^(균필|균형)/.test(catOf(c)),
    basic: (c) => /^(학기|기필|학문기초|학필)/.test(catOf(c)),
    mBasic: (c) => /^(전기|전공기초)/.test(catOf(c)),
    mReq: (c) => /^(전필|전공필수)/.test(catOf(c)),
    mElec: (c) => /^(전선|전공선택)/.test(catOf(c)),
  };

  function deptRule(gradData, pid, year) {
    const ys = Object.keys(gradData.years).sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || b - a);
    for (const k of ys) {
      const y = gradData.years[k];
      const name = (DEPT[pid] || []).find((n) => y.depts[n]);
      if (name) return { year: k, asked: String(year), from: y.from, dept: name, req: y.depts[name], common: y.common, cert: y.cert, src: y.src, catalog: y.catalog, diff: (y.catalogDiff || {})[name] };
    }
    return null;
  }

  function sameCommon(a, b) {
    if (E.same(a, b)) return true;
    if (E.renamed && E.renamed(a, b, null)) return true; // 수강편람 공식 동일·대체 과목
    return COMMON_ALIAS.some((g) => g.some((x) => E.same(x, a)) && g.some((x) => E.same(x, b)));
  }

  /**
   * courses: 성적표 과목 (재수강 정리 전 원본), certs: {영어졸업인증: true, ...}
   * 반환: { rows:[{id,label,earned,min,ok,unknown,note}], ok, total, catKnown }
   */
  function evaluateGrad(dr, rawCourses, certs) {
    const courses = E.uniqueCourses(rawCourses);
    const sum = (f) => courses.filter(f).reduce((s, c) => s + (Number(c.credit) || 0), 0);
    const catKnown = courses.filter((c) => catOf(c)).length >= Math.max(3, courses.length * 0.5);
    const r = dr.req;
    const rows = [];
    const row = (id, label, earned, min, opt) => { if (min > 0) rows.push(Object.assign({ id, label, earned, min, ok: earned >= min }, opt || {})); };

    const total = sum(() => true);
    row("total", "졸업 이수학점", total, r.grad);

    // 공통필수: 과목 목록으로 확인 (이수구분이 없어도 판정 가능)
    const missingCommon = dr.common.filter((x) => !courses.some((c) => sameCommon(c.name, x.name)));
    const commonEarned = dr.common.filter((x) => !missingCommon.includes(x)).reduce((s, x) => s + x.credit, 0);
    rows.push({ id: "common", label: "교양 공통필수 과목", earned: dr.common.length - missingCommon.length, min: dr.common.length, unit: "과목",
      ok: missingCommon.length === 0, note: missingCommon.length ? `남은 과목: ${missingCommon.map((x) => x.name).join(", ")}` : "", credits: commonEarned });

    const unknownNote = "성적표에 이수구분(공필·균필·학기·전기·전필·전선)이 없어 판정할 수 없습니다. 기이수성적 엑셀이나 이수구분이 있는 표를 넣어 주세요.";
    const catRow = (id, label, f, min) => row(id, label, sum(f), min, catKnown ? {} : { unknown: true, ok: null, note: unknownNote });
    if (r.geElective1) catRow("ge1", "교양선택(1영역)", (c) => /^(교선|교양선택)/.test(catOf(c)), r.geElective1);
    catRow("balance", "균형교양", is.balance, r.geBalance);
    catRow("basic", "학문기초교양", is.basic, r.geBasic);
    catRow("mBasic", "전공기초", is.mBasic, r.majorBasic);
    catRow("mReq", "전공필수", is.mReq, r.majorReq);
    // 전공필수를 기준보다 많이 들으면 넘친 학점은 전공선택으로 인정
    const reqCr = sum(is.mReq), extra = Math.max(0, reqCr - r.majorReq);
    if (r.majorElec > 0) {
      const elecCr = sum(is.mElec) + extra;
      rows.push(Object.assign({ id: "mElec", label: "전공선택", earned: elecCr, min: r.majorElec, ok: elecCr >= r.majorElec,
        note: extra > 0 ? `전공필수 초과 ${extra}학점을 전공선택으로 인정` : "" }, catKnown ? {} : { unknown: true, ok: null, note: unknownNote }));
    }

    // 졸업인증제
    if (dr.cert) {
      const got = dr.cert.items.filter((x) => certs && certs[x]);
      rows.push({ id: "cert", label: `졸업인증 (${dr.cert.items.length}개 중 ${dr.cert.pick}개)`, earned: got.length, min: dr.cert.pick, unit: "개",
        ok: got.length >= dr.cert.pick, note: dr.cert.note || "", cert: true });
    }
    const ok = rows.every((x) => x.ok !== false) && rows.every((x) => x.ok !== null);
    return { rows, ok, total, catKnown, missingCommon };
  }

  /**
   * 공학인증 유지와 포기(학과 졸업요건만)의 남은 학점 비교.
   * abeekPlanCredits: 공학인증 요건을 채우려고 더 들어야 하는 학점(추천 계획 합)
   */
  function compare(gradRes, abeekRes, abeekPlanCredits, cap) {
    const gap = (id) => { const x = gradRes.rows.find((r) => r.id === id); return x && !x.unknown ? Math.max(0, x.min - x.earned) : 0; };
    const totalGap = gap("total");
    const geGap = gap("balance") + gap("basic") + gap("ge1");
    const majorGap = gap("mBasic") + gap("mReq") + gap("mElec");
    const commonCr = (gradRes.missingCommon || []).reduce((s, x) => s + (x.credit || 1), 0);
    // 포기: 학과 졸업요건만
    const quit = Math.max(totalGap, geGap + majorGap + commonCr);
    // 유지: 공학인증 계획 학점은 대부분 전공·MSC로 학과 요건에도 들어간다고 본다
    const keep = Math.max(totalGap, abeekPlanCredits + geGap + commonCr + Math.max(0, majorGap - abeekPlanCredits));
    const openGrad = gradRes.rows.filter((r) => r.ok === false && r.id !== "total").length;
    const openAbeek = abeekRes.checks.filter((c) => !c.ok).length;
    const sem = (n) => (n <= 0 ? 0 : Math.ceil(n / (cap || 18)));
    return {
      keep: { credits: keep, semesters: sem(keep), open: openGrad + openAbeek },
      quit: { credits: quit, semesters: sem(quit), open: openGrad },
    };
  }

  const QUIT_REASONS = ["복수전공", "부전공", "학석사 연계과정", "교직과정", "전과생", "편입생", "ROTC", "연계융합전공", "외국인 유학생", "국외 대학 1학기 이상 학점교류", "프로그램 운영위원회 인정"];

  const api = { DEPT, deptRule, evaluateGrad, compare, QUIT_REASONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GRAD = api;
})(typeof self !== "undefined" ? self : this);
