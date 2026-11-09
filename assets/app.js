/* 화면 로직 */
(function () {
  "use strict";
  const E = window.ABEEK, P = window.TRANSCRIPT, C = window.CAREERS, SH = window.SHEET;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const AREA_LABEL = { GE: "전문교양", MSC: "MSC(BSM)", MAJOR: "전공", OTHER: "인증 영역 아님" };
  const GROUP_LABEL = { GE: "전문교양", MSC: "MSC", MAJOR: "전공", DESIGN: "설계", EXTRA: "추가 조건" };
  const FAMILY_ORDER = ["sw", "robot", "ee", "mech", "aero", "nano", "nuclear", "civil", "arch", "env", "energy"];

  let DATA = null, KNOWN = [];
  const S = { courses: [], program: null, admit: null, basis: null, track: null, next: null, cap: 15, autoProgram: false };

  const PERSON = { sid: "", name: "", gradDate: "" }; // 저장하지 않음
  const store = {
    load() { try { return JSON.parse(localStorage.getItem("abeek-check") || "null"); } catch (e) { return null; } },
    save() { try { localStorage.setItem("abeek-check", JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ } },
  };

  // ---------- 데이터 ----------
  async function boot() {
    try {
      const res = await fetch("data/abeek.json");
      DATA = await res.json();
    } catch (e) {
      $("#readStatus").textContent = "요건 데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
      $("#readStatus").className = "status err";
      return;
    }
    const names = new Set();
    Object.values(DATA.programs).forEach((p) => Object.values(p.years).forEach((r) => {
      r.catalog.forEach((c) => names.add(c.name));
      [r.ge.required, r.ge.electives, r.msc.required, r.msc.electives, r.major.required, r.design.basic, r.design.element, r.design.capstone]
        .forEach((l) => (l || []).forEach((n) => names.add(n)));
    }));
    KNOWN = [...names].filter((n) => n.length >= 2);

    const saved = store.load();
    if (saved && saved.courses) Object.assign(S, saved);
    fillPrograms();
    if (!S.program) S.program = "03";
    syncSelects();
    bind();
    if (S.courses.length) render();
  }

  const prog = () => DATA.programs[S.program];
  const rule = () => {
    const p = prog();
    return p.years[S.basis] || p.years[S.admit] || p.years[Object.keys(p.years).sort().pop()];
  };

  function fillPrograms() {
    const sel = $("#program");
    const ids = Object.keys(DATA.programs).sort((a, b) => FAMILY_ORDER.indexOf(DATA.programs[a].family) - FAMILY_ORDER.indexOf(DATA.programs[b].family));
    sel.innerHTML = ids.map((id) => `<option value="${id}">${esc(DATA.programs[id].dept)}</option>`).join("");
  }

  function syncSelects() {
    const p = prog();
    $("#program").value = S.program;
    const years = Object.keys(p.years).sort();
    if (!years.includes(S.admit)) S.admit = years.includes("2024") ? "2024" : years[years.length - 1];
    $("#admit").innerHTML = years.map((y) => `<option value="${y}">${y}학번</option>`).join("");
    $("#admit").value = S.admit;
    const later = years.filter((y) => y >= S.admit);
    if (!later.includes(S.basis)) S.basis = S.admit;
    $("#basis").innerHTML = later.map((y) => `<option value="${y}">${y === S.admit ? "입학 연도 기준" : `${y}년 기준`}</option>`).join("");
    $("#basis").value = S.basis;
    const notes = [];
    if (S.autoProgram) notes.push("성적표 과목으로 학과를 추정했습니다. 다르면 바꿔 주세요.");
    if (p.status) notes.push(p.status);
    if (S.basis !== S.admit) notes.push("인증기준이 바뀐 경우 졸업 시점 기준을 적용받을 수 있습니다. 적용 가능 여부는 공학교육센터에 확인하세요.");
    $("#programNote").innerHTML = notes.map(esc).join("<br>");

    const tracks = C.forFamily(p.family);
    if (!tracks.some((t) => t.id === S.track)) S.track = tracks[0].id;
    $("#tracks").innerHTML = tracks.map((t) => `<button type="button" class="chip" role="radio" aria-checked="${t.id === S.track}" data-id="${t.id}">${esc(t.label)}</button>`).join("");

    const terms = [];
    for (let y = 1; y <= 4; y++) for (let s = 1; s <= 2; s++) terms.push(`${y}-${s}`);
    terms.push("5-1", "5-2");
    if (!S.next) S.next = guessNext();
    $("#nextTerm").innerHTML = terms.map((t) => { const [y, s] = t.split("-"); return `<option value="${t}">${y <= 4 ? `${y}학년 ${s}학기` : `추가 ${s}학기`}</option>`; }).join("");
    $("#nextTerm").value = S.next;
    $("#cap").value = String(S.cap);
  }

  function guessNext() {
    const regular = new Set(S.courses.map((c) => c.term).filter((t) => /-(1|2)$/.test(t || "")));
    const n = regular.size;
    if (!n) return "1-1";
    const y = Math.min(5, Math.floor(n / 2) + 1), s = (n % 2) + 1;
    return `${y}-${s}`;
  }

  function guessProgram(courses) {
    let best = null, bestScore = 0;
    Object.entries(DATA.programs).forEach(([id, p]) => {
      const r = p.years[S.admit] || p.years[Object.keys(p.years).sort().pop()];
      const major = r.catalog.filter((c) => c.area === "MAJOR");
      const score = courses.filter((c) => major.some((m) => E.same(m.name, c.name))).length;
      if (score > bestScore) { bestScore = score; best = id; }
    });
    return bestScore >= 3 ? best : null;
  }

  function guessAdmit(courses) {
    const ys = courses.map((c) => parseInt((c.term || "").slice(0, 4), 10)).filter(Boolean);
    return ys.length ? String(Math.min(...ys)) : null;
  }

  // ---------- 입력 ----------
  function accept(list, source) {
    const st = $("#readStatus");
    if (!list.length) {
      st.textContent = `${source}에서 과목을 찾지 못했습니다. 과목명·학점·등급이 한 줄에 있는지 확인하거나, 표를 복사해 붙여넣어 보세요.`;
      st.className = "status err";
      return;
    }
    S.courses = list.map((c, i) => Object.assign({ id: Date.now() + "-" + i }, c));
    const a = guessAdmit(S.courses);
    if (a) S.admit = a;
    const g = guessProgram(S.courses);
    if (g) { S.program = g; S.autoProgram = true; }
    S.basis = null; S.next = null;
    st.textContent = `${source}에서 ${list.length}과목을 읽었습니다.`;
    st.className = "status";
    syncSelects();
    render();
  }

  async function readFile(file) {
    const st = $("#readStatus");
    st.className = "status"; st.textContent = `${file.name} 읽는 중…`;
    try {
      let text;
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        if (!window.pdfjsLib) throw new Error("PDF 해석기를 불러오지 못했습니다. 인터넷 연결을 확인하거나 표를 붙여넣어 주세요.");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        text = await P.parsePdf(file, window.pdfjsLib);
        if (!text.trim()) throw new Error("이 PDF에는 글자 정보가 없습니다(스캔본). 학사정보시스템 표를 복사해 붙여넣어 주세요.");
      } else {
        text = await file.text();
      }
      accept(P.parseText(text, KNOWN), file.name);
    } catch (e) {
      st.textContent = e.message || String(e);
      st.className = "status err";
    }
  }

  function bind() {
    const drop = $("#drop");
    $("#file").addEventListener("change", (e) => e.target.files[0] && readFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
    $("#pasteBtn").addEventListener("click", () => accept(P.parseText($("#paste").value, KNOWN), "붙여넣은 내용"));
    $("#sampleBtn").addEventListener("click", () => { accept(P.parseText(SAMPLE, KNOWN), "예시 성적"); });
    $("#program").addEventListener("change", (e) => { S.program = e.target.value; S.autoProgram = false; S.basis = null; syncSelects(); render(); });
    $("#admit").addEventListener("change", (e) => { S.admit = e.target.value; S.basis = null; syncSelects(); render(); });
    $("#basis").addEventListener("change", (e) => { S.basis = e.target.value; syncSelects(); render(); });
    $("#nextTerm").addEventListener("change", (e) => { S.next = e.target.value; render(); });
    $("#cap").addEventListener("change", (e) => { S.cap = Number(e.target.value); render(); });
    $("#tracks").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      S.track = b.dataset.id;
      document.querySelectorAll("#tracks .chip").forEach((c) => c.setAttribute("aria-checked", c === b));
      render();
    });
    $("#courseRows").addEventListener("change", (e) => {
      const id = e.target.dataset.id; if (!id) return;
      const c = S.courses.find((x) => x.id === id);
      c.area = e.target.value === "auto" ? undefined : e.target.value;
      render();
    });
    $("#courseRows").addEventListener("click", (e) => {
      const id = e.target.dataset.del; if (!id) return;
      S.courses = S.courses.filter((x) => x.id !== id); render();
    });
    const tab = (which) => {
      S.tab = which;
      $("#tabResult").setAttribute("aria-selected", which === "result");
      $("#tabSheet").setAttribute("aria-selected", which === "sheet");
      $("#panelResult").hidden = which !== "result";
      $("#panelSheet").hidden = which !== "sheet";
      render();
    };
    $("#tabResult").addEventListener("click", () => tab("result"));
    $("#tabSheet").addEventListener("click", () => tab("sheet"));
    $("#sheetKind").addEventListener("change", (e) => { S.sheetKind = e.target.value; render(); });
    $("#curTerm").addEventListener("change", (e) => { S.curTerm = e.target.value; render(); });
    ["sid", "sname", "gradDate"].forEach((id) => $("#" + id).addEventListener("input", (e) => { PERSON[id === "sname" ? "name" : id] = e.target.value; render(); }));
    $("#printBtn").addEventListener("click", () => window.print());
    $("#csvBtn").addEventListener("click", () => {
      const r = rule(), res = E.evaluate(r, S.courses);
      const blob = new Blob([SH.csv(r, res, S.courses, sheetInfo())], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `공학인증_상담표_${prog().name}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("#addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#addName").value.trim(); if (!name) return;
      S.courses.push({ id: "m" + Date.now(), name, credit: Number($("#addCredit").value) || 3, grade: "", cat: "", term: $("#addTerm").value.trim() });
      $("#addName").value = ""; render();
    });
  }

  // ---------- 출력 ----------
  function render() {
    if (!S.courses.length) { $("#out").hidden = true; $("#empty").hidden = false; return; }
    $("#out").hidden = false; $("#empty").hidden = true;
    const tabNow = S.tab === "sheet" ? "sheet" : "result";
    $("#tabResult").setAttribute("aria-selected", tabNow === "result");
    $("#tabSheet").setAttribute("aria-selected", tabNow === "sheet");
    $("#panelResult").hidden = tabNow !== "result";
    $("#panelSheet").hidden = tabNow !== "sheet";
    const r = rule();
    const res = E.evaluate(r, S.courses);
    const track = C.tracks.find((t) => t.id === S.track);
    const [ny, ns] = S.next.split("-").map(Number);
    const rec = E.recommend(r, res, { track, nextYear: ny, nextSem: ns, cap: S.cap });
    store.save();
    if (S.tab === "sheet") { renderSheet(r, res); return; }

    // 판정
    const shortAreas = res.areas.filter((a) => !a.ok);
    const openChecks = res.checks.filter((c) => !c.ok);
    const v = $("#verdict");
    v.className = "verdict " + (res.ok ? "ok" : "no");
    const planned = rec.chosen.reduce((s, c) => s + c.credit, 0);
    v.innerHTML = res.ok
      ? `<span class="big">공학인증 요건을 모두 채웠습니다</span><p>${esc(prog().dept)} ${esc(S.basis)}년 기준. 졸업 전 공학교육센터에서 최종 확인을 받으세요.</p>`
      : `<span class="big">${shortAreas.length ? shortAreas.map((a) => `${a.label} ${fmt(a.min - a.earned)}학점`).join(", ") + " 부족" : "학점은 채웠고 필수 과목이 남았습니다"}</span>
         <p>필수 조건 ${openChecks.length}개가 아직 남았습니다. 아래 계획대로 ${planned}학점(${rec.chosen.length}과목)을 더 들으면 요건을 채웁니다.</p>`;

    // 눈금자
    const plannedBy = { GE: 0, MSC: 0, MAJOR: 0, DESIGN: 0 };
    rec.chosen.forEach((c) => { plannedBy[c.area] = (plannedBy[c.area] || 0) + c.credit; plannedBy.DESIGN += c.design || 0; });
    $("#rulers").innerHTML = res.areas.map((a) => {
      const total = Math.max(a.min, Math.ceil(a.earned));
      const have = Math.floor(a.earned), plan = Math.max(0, Math.min(Math.ceil(a.min - a.earned), Math.round(plannedBy[a.id] || 0)));
      let ticks = "";
      for (let i = 0; i < total; i++) {
        const cls = i < Math.min(have, a.min) ? "" : i >= a.min ? "over" : i < have + plan ? "plan" : "miss";
        ticks += `<span class="tick ${cls}"></span>`;
      }
      return `<div class="ruler">
        <div class="ruler-head"><b>${a.label}</b><span class="val ${a.ok ? "" : "short"}"><strong>${fmt(a.earned)}</strong> / ${fmt(a.min)}학점</span></div>
        <div class="ticks" role="img" aria-label="${a.label} ${fmt(a.earned)}학점 이수, 최소 ${fmt(a.min)}학점">${ticks}</div>
        ${!a.ok && plan ? `<div class="ruler-foot">빗금 ${plan}칸은 추천 계획으로 채워지는 학점</div>` : ""}
      </div>`;
    }).join("");

    // 필수 조건
    const order = [...res.checks].sort((a, b) => a.ok - b.ok);
    const doneCount = res.checks.filter((c) => c.ok).length;
    $("#checks").innerHTML = order.map((c, i) => `<li ${c.ok && i >= openChecks.length ? 'class="done"' : ""}${c.ok ? " data-ok" : ""}>
        <span class="mark ${c.ok ? "ok" : "no"}" aria-label="${c.ok ? "충족" : "미충족"}">${c.ok ? "✓" : ""}</span>
        <span>${esc(c.label)}<span class="det">${esc(c.detail)}</span></span>
        <span class="grp">${GROUP_LABEL[c.group]}</span></li>`).join("")
      + (doneCount ? `<li class="toggle-row"><button type="button" class="link toggle" id="toggleDone">충족한 ${doneCount}개 ${S.showDone ? "숨기기" : "보기"}</button></li>` : "");
    document.querySelectorAll("#checks li[data-ok]").forEach((li) => (li.hidden = !S.showDone));
    const tg = $("#toggleDone");
    if (tg) tg.onclick = () => { S.showDone = !S.showDone; render(); };

    // 계획
    $("#planSub").textContent = `${track ? track.label : ""} 진로 기준 · 학기당 인증과목 최대 ${S.cap}학점`;
    const d = r.design || {};
    $("#plan").innerHTML = rec.semesters.length ? rec.semesters.filter((s) => s.courses.length).map((s) => {
      const sum = s.courses.reduce((a, c) => a + c.credit, 0);
      return `<li><div class="when">${esc(s.label)}<small>${sum}학점</small></div><ul>${s.courses.map((c) => {
        const tags = [];
        if (c.kind === "required") tags.push('<span class="tag req">필수</span>');
        if (c.design) tags.push(`<span class="tag dsg">설계 ${fmt(c.design)}</span>`);
        if (c.fit > 0) tags.push('<span class="tag fit">진로</span>');
        const when = c.year && c.sem ? `권장 ${c.year}-${c.sem}` : c.sem ? `${c.sem}학기 개설` : "";
        return `<li class="c"><span><span class="nm">${esc(c.name)}</span>${tags.join("")}<span class="why">${esc([c.reason, when].filter(Boolean).join(" · "))}</span></span><span class="cr">${fmt(c.credit)}학점</span></li>`;
      }).join("")}</ul></li>`;
    }).join("") : `<li><div class="when">추가 수강 없음</div><ul><li class="c"><span>인증 요건만 보면 더 들을 과목이 없습니다.</span></li></ul></li>`;
    if (rec.gaps.length) $("#plan").innerHTML += `<li><div class="when">더 필요한 학점</div><ul><li class="c"><span>교과과정표에서 고를 과목이 부족합니다. ${rec.gaps.map((g) => `${esc(g.label)} ${fmt(g.left)}학점`).join(", ")}을 인정 과목으로 더 들어야 합니다. 학과 사무실에서 인정 과목 목록을 확인하세요.</span></li></ul></li>`;
    if (rec.unplaced.length) $("#plan").innerHTML += `<li><div class="when">배치 못 함</div><ul>${rec.unplaced.map((c) => `<li class="c"><span class="nm">${esc(c.name)}</span><span class="cr">${fmt(c.credit)}학점</span></li>`).join("")}</ul></li>`;
    $("#picks").innerHTML = rec.picks.length ? `<div class="picks"><h3>요건과 별개로 이 진로에 도움이 되는 과목</h3><p>${rec.picks.map((p) => esc(p.name) + (p.year ? ` (${p.year}-${p.sem || "?"})` : "")).join(", ")}</p></div>` : "";

    // 과목 표
    const evalMap = new Map(res.courses.map((c) => [c.id, c]));
    const rows = [...S.courses].sort((a, b) => (E.termOrder(a.term) || 0) - (E.termOrder(b.term) || 0));
    $("#courseRows").innerHTML = rows.map((c) => {
      const ev = evalMap.get(c.id);
      const failed = !ev && c.grade && /^(F|NP|U|W)$/i.test(c.grade);
      const area = ev ? ev.area : null;
      const how = ev ? ev.how : failed ? "미이수 등급" : "재수강 이전 기록";
      const opts = ["auto", "GE", "MSC", "MAJOR", "OTHER"].map((k) => `<option value="${k}" ${(c.area || "auto") === k ? "selected" : ""}>${k === "auto" ? `자동: ${area ? AREA_LABEL[area] : "-"}` : AREA_LABEL[k]}</option>`).join("");
      const dc = ev && ev.area === "MAJOR" ? E.designCredit(r, c.name) : 0;
      return `<tr class="${failed ? "fail" : ""} ${ev && ev.guess ? "guess" : ""}">
        <td>${esc(c.term || "")}</td>
        <td>${esc(c.name)}${dc ? ` <span class="tag dsg">설계 ${fmt(dc)}</span>` : ""}<span class="how">${esc(how)}</span></td>
        <td class="num">${fmt(c.credit)}</td><td>${esc(c.grade || "")}</td>
        <td><select data-id="${c.id}" aria-label="${esc(c.name)} 인증 영역">${opts}</select> <button class="del" data-del="${c.id}" aria-label="${esc(c.name)} 삭제" title="삭제">✕</button></td></tr>`;
    }).join("");

    // 근거
    const notDesign = res.designRows.filter((x) => !x.counted);
    const guesses = res.courses.filter((c) => c.guess).length;
    const n = r.notes || {};
    $("#notes").innerHTML = `
      ${guesses ? `<p class="warn">교과과정표에 없는 과목 ${guesses}개는 성적표 이수구분(전필·전선)만 보고 전공으로 셌습니다. 노란 테두리 과목을 확인해 주세요.</p>` : ""}
      ${notDesign.length ? `<p class="warn">설계학점으로 인정하지 않은 과목: ${notDesign.map((x) => `${esc(x.name)}(${esc(x.why)})`).join(", ")}</p>` : ""}
      ${r.catalogFrom ? `<p>${esc(S.basis)}학번 이수체계표가 게시되지 않아, 과목 분류와 추천에는 ${esc(r.catalogFrom)}학번 표를 사용했습니다.</p>` : ""}
      <p>${esc(prog().name)} 프로그램, ${esc(S.basis)}년 공학인증요건 기준. 원문: <a href="${esc(r.src)}" target="_blank" rel="noopener">공학교육센터 페이지</a></p>
      <details><summary>요건 원문 보기</summary>
        ${["GE", "MSC", "MAJOR", "TOTAL", "notice"].filter((k) => n[k]).map((k) => `<p class="raw"><b>${{ GE: "전문교양", MSC: "MSC/BSM", MAJOR: "전공·설계", TOTAL: "인증 최소학점", notice: "공지" }[k]}</b>\n${esc(n[k])}</p>`).join("")}
      </details>`;
  }

  const fmt = (x) => (Math.round(x * 10) / 10).toString();

  function sheetInfo() {
    const now = new Date();
    return {
      programName: prog().name, basis: S.basis, currentTerm: S.curTerm || "",
      sid: PERSON.sid, name: PERSON.name, gradDate: PERSON.gradDate,
      date: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`,
    };
  }

  function renderSheet(r, res) {
    const terms = [...new Set(S.courses.map((c) => c.term).filter(Boolean))].sort((a, b) => (E.termOrder(a) || 0) - (E.termOrder(b) || 0));
    if (S.curTerm === undefined || (S.curTerm && !terms.includes(S.curTerm))) S.curTerm = terms[terms.length - 1] || "";
    $("#curTerm").innerHTML = `<option value="">없음(모두 이수 완료)</option>` + terms.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    $("#curTerm").value = S.curTerm;
    $("#sheetKind").value = S.sheetKind || "consult";
    const info = sheetInfo();
    $("#sheetOut").innerHTML = (S.sheetKind || "consult") === "review" ? SH.reviewSheet(r, res, S.courses, info) : SH.consultSheet(r, res, S.courses, info);
    const t = SH.tips(r, res, S.courses, info);
    $("#tipsMine").innerHTML = t.mine.length
      ? `<h3>내 성적에 맞춘 팁</h3><ul class="mine">${t.mine.map((x) => `<li>${x}</li>`).join("")}</ul>`
      : `<p class="hint">재수강, 선후수 위반, 설계 미인정처럼 따로 챙길 항목이 없습니다.</p>`;
    $("#tipsGeneral").innerHTML = t.general.map((x) => `<li>${x}</li>`).join("");
    $("#tipsDocs").innerHTML = t.docs.map((x) => `<li>${esc(x)}</li>`).join("");
    store.save();
  }

  const SAMPLE = `2024학년도 1학기
문제해결을위한글쓰기와발표	교필	3	A+
미적분학1	전기	3	B+
확률및통계	전기	3	A0
C프로그래밍및실습	전기	3	A+
2024학년도 2학기
대학영어	교필	2	A0
서양철학:쟁점과토론	교필	3	B0
공업수학1	전기	3	B+
선형대수	전기	3	A0
고급C프로그래밍및실습	전선	3	A0
2025학년도 1학기
자료구조및실습	전필	3	A+
디지털시스템	전필	3	B+
공학설계기초(산학프로젝트입문)	전필	3	A0
웹프로그래밍	전선	3	A0
일반물리학1	전기	3	C+
2025학년도 2학기
알고리즘및실습	전필	3	B+
이산수학및프로그래밍	전기	3	A0
데이터베이스	전선	3	A+
세계사	교선	3	A0
2026학년도 1학기
운영체제	전필	3	B0
기계학습	전선	3	A+
컴퓨터네트워크	전필	3	F
경영학	교선	3	A0`;

  boot();
})();
