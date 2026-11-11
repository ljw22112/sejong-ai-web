/* 회귀 테스트: node tests/run.js */
const fs = require("fs"), path = require("path");
global.self = global;
const E = require("../assets/engine.js");
global.ABEEK = E;
const P = require("../assets/parser.js");
const C = require("../assets/careers.js");
const G = require("../assets/grad.js");
const SH = require("../assets/sheet.js");
const T = require("../assets/timetable.js");
const D = require("../data/abeek.json");
E.setRenames(require("../data/renames.json"));
const GD = require("../data/grad.json");
const OFF = fs.existsSync(path.join(__dirname, "../data/offered.json")) ? require("../data/offered.json") : null;
const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const KNOWN = [...new Set(Object.values(D.programs).flatMap((p) => Object.values(p.years).flatMap((r) => [...r.catalog.map((c) => c.name), ...r.ge.required, ...r.ge.electives, ...r.msc.required, ...r.major.required, ...r.design.basic, ...r.design.element, ...r.design.capstone])))];

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("✗", name, "-", e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ""} 기대 ${JSON.stringify(b)} 실제 ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "조건 불만족"); };

t("PDF 칸 안 줄바꿈 과목명 복원", () => {
  const r = P.parseText(fx("pdf_wrapped.txt"), KNOWN);
  const names = r.map((c) => c.name);
  ok(names.includes("문제해결을위한글쓰기와발표"), names.join(","));
  ok(names.includes("공학설계기초(산학프로젝트입문)"), names.join(","));
  ok(names.includes("디지털시스템"), "두 단 합쳐진 줄 분리");
  eq(r.find((c) => c.name === "자료구조및실습").term, "2025-1", "제1학기 표기");
});

t("글자 인식(OCR) 결과 보정", () => {
  const r = P.parseText(fx("ocr_two_column.txt"), KNOWN, { fuzzy: true });
  ok(r.length >= 21, `과목 수 ${r.length}`);
  ok(r.some((c) => c.name === "C프로그래밍및실습" && c.grade === "A+"), "C프로그래밍 오인식 보정");
  ok(r.some((c) => c.name === "확률및통계" && c.grade === "A0"), "A0 오인식 보정");
  ok(r.some((c) => c.name === "컴퓨터네트워크" && c.grade === "F"), "F 인식");
});

t("엑셀 머리글 매핑", () => {
  const rows = [["년도", "학기", "교과목명", "이수구분", "학점", "등급"], ["2024", "1학기", "자료구조및실습", "전필", "3", "A+"], ["", "", "합계", "", "3", ""]];
  eq(P.parseRows(rows, KNOWN).map((c) => [c.name, c.term, c.cat]), [["자료구조및실습", "2024-1", "전필"]]);
});

t("이름 바뀐 과목 인정", () => {
  const r = D.programs["03"].years["2023"];
  const res = E.evaluate(r, [{ id: "1", name: "미적분학1", credit: 3, grade: "A0", term: "2023-1" }]);
  eq(res.renamed.map((x) => [x.from, x.to, x.type]), [["미적분학1", "기초미적분학", "sub"]]);
});

t("이름 변경: 공식·추정·오판 구분", () => {
  ok(E.renamed("일반물리학및실험1", "일반물리학1", null), "공식 동일");
  ok(!E.renamed("고급프로그래밍활용", "프로그래밍활용-C", "13"), "서로 다른 과목");
  ok(E.renamed("고급프로그래밍입문-C", "프로그래밍활용-C", null));
  ok(E.renamed("확률통계및프로그래밍", "확률및통계", "03"), "추정은 지정 학과에서만");
  ok(!E.renamed("확률통계및프로그래밍", "확률및통계", "13"));
  ok(E.same("확률통계및프록래밍", "확률통계및프로그래밍"), "표기 차이");
  const r = D.programs["19"].years["2026"];
  const res = E.evaluate(r, [{ id: "1", name: "기초설계", credit: 3, grade: "A0", term: "2025-2" }]);
  eq(res.renamed.map((x) => [x.to, x.type]), [["AI융합기초설계", "probable"]]);
});

t("2026학번 공통필수 7과목(수강편람)", () => {
  const dr = G.deptRule(GD, "03", 2026);
  eq(dr.common.map((x) => x.name), ["세종인을위한진로설계", "세종인을위한전공탐색", "대학영어", "창업과기업가정신", "비판적사고와창의적글쓰기", "서양철학:쟁점과토론", "취창업과진로역량개발"]);
  eq(dr.req.geCommon, 12);
  const g = G.evaluateGrad(G.deptRule(GD, "03", 2025), [{ id: "1", name: "창업과기업가정신", credit: 1, grade: "P", cat: "공필", term: "2026-1" }], {});
  ok(!g.missingCommon.some((x) => x.name === "창업과기업가정신1"), "새 이름으로 들어도 2025학번 공통필수 인정");
});

t("설계 순서: 기초설계 전 요소설계 미인정", () => {
  const r = D.programs["03"].years["2024"];
  const res = E.evaluate(r, [
    { id: "1", name: "고급C프로그래밍및실습", credit: 3, grade: "A0", term: "2024-2" },
    { id: "2", name: "공학설계기초(산학프로젝트입문)", credit: 3, grade: "A0", term: "2025-1" },
  ]);
  ok(res.designRows.find((x) => x.name === "고급C프로그래밍및실습").counted === false);
});

t("종합설계 시점 설계학점 경고", () => {
  const r = D.programs["03"].years["2024"];
  const res = E.evaluate(r, [
    { id: "1", name: "공학설계기초(산학프로젝트입문)", credit: 3, grade: "A0", term: "2025-1" },
    { id: "2", name: "Capstone디자인(산학협력프로젝트)", credit: 6, grade: "A0", term: "2025-2" },
  ]);
  ok(res.checks.some((c) => /종합설계 수강 학기까지/.test(c.label) && !c.ok));
});

t("모든 프로그램·학번·진로 추천 동작", () => {
  let n = 0;
  for (const [pid, p] of Object.entries(D.programs)) for (const [y, r] of Object.entries(p.years)) {
    const cs = r.catalog.filter((c) => c.year === 1).map((c, i) => ({ id: "" + i, name: c.name, credit: c.credit, grade: "A0", term: `${y}-${c.sem || 1}` }));
    const res = E.evaluate(r, cs);
    for (const tr of C.forFamily(p.family)) { E.recommend(r, res, { track: tr, nextYear: 1, nextSem: 2, cap: 15 }); n++; }
    SH.consultSheet(r, res, cs, { programName: p.name, basis: y }); SH.reviewSheet(r, res, cs, { programName: p.name, basis: y });
    ok(G.deptRule(GD, pid, Number(y)), `학과 졸업요건 없음 ${pid} ${y}`);
  }
  ok(n > 400);
});

t("학과 졸업요건 판정", () => {
  const dr = G.deptRule(GD, "03", 2024);
  eq([dr.dept, dr.req.grad, dr.req.majorReq], ["컴퓨터공학과", 130, 21]);
  const g = G.evaluateGrad(dr, [{ id: "1", name: "세종인을위한진로설계", credit: 1, grade: "P", cat: "공필", term: "2024-1" },
    { id: "2", name: "자료구조및실습", credit: 3, grade: "A0", cat: "전필", term: "2024-1" },
    { id: "3", name: "웹프로그래밍", credit: 3, grade: "A0", cat: "전선", term: "2024-1" }], { 영어졸업인증: true, 소프트웨어코딩졸업인증: true });
  ok(g.rows.find((x) => x.id === "cert").ok, "졸업인증 2개");
  eq(g.rows.find((x) => x.id === "mReq").earned, 3);
});

t("전공필수 초과분은 전공선택으로 인정", () => {
  const dr = G.deptRule(GD, "03", 2024); // 전필 21, 전선 39
  const cs = Array.from({ length: 9 }, (_, i) => ({ id: "r" + i, name: "전필과목" + i, credit: 3, grade: "A0", cat: "전필", term: "2024-1" }))
    .concat(Array.from({ length: 4 }, (_, i) => ({ id: "e" + i, name: "전선과목" + i, credit: 3, grade: "A0", cat: "전선", term: "2024-1" })));
  const g = G.evaluateGrad(dr, cs, {});
  const req = g.rows.find((x) => x.id === "mReq"), el = g.rows.find((x) => x.id === "mElec");
  eq([req.earned, req.ok, el.earned], [27, true, 18]); // 전필 27 → 초과 6 + 전선 12
  ok(/초과 6학점/.test(el.note));
});

t("시간표: 겹침 없음", () => {
  eq(T.parseTime("화목09:00-10:30,금13:00-15:00").length, 3);
  const secs = { A: [{ cl: "001", t: "월수09:00-10:30" }], B: [{ cl: "001", t: "월10:00-11:00" }, { cl: "002", t: "화10:00-11:00" }], C: [{ cl: "001", t: "" }] };
  const r = T.build([{ name: "A", credit: 3, weight: 10 }, { name: "B", credit: 3, weight: 5 }, { name: "C", credit: 3, weight: 1 }], (n) => secs[n], { cap: 9 }, 3)[0];
  eq(r.courses.map((c) => c.name + c.sec.cl), ["A001", "B002", "C001"]);
});

t("수강편람 2021-1~2026-2 반영", () => {
  ok(E.renamed("고급프로그래밍입문", "프로그래밍활용-C", null), "고급프로그래밍입문 = 프로그래밍활용-C");
  ok(E.renamed("English Writing 1", "영어3", null));
  ok(!E.renamed("프로그래밍입문", "프로그래밍활용-P", null), "프로그래밍입문(옛 C)과 -P는 다른 과목");
  eq(G.deptRule(GD, "05", 2025).req.majorReq, 31);
  eq(G.deptRule(GD, "18", 2021).dept, "인공지능학과");
  eq(G.deptRule(GD, "10", 2022).req.majorElec, 48);
});

if (OFF) t("수강편람 데이터 형식", () => { ok(OFF.count > 300); ok(Object.values(OFF.courses)[0][0].hasOwnProperty("t")); });

console.log(`${pass}개 통과, ${fail}개 실패`);
process.exit(fail ? 1 : 0);
