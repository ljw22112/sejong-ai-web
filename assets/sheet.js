/* 공학인증 체크표(이수체계준수 상담표 · 졸업심사서) 미리 채우기와 작성 팁 */
(function (root) {
  "use strict";
  const E = root.ABEEK || (typeof require !== "undefined" ? require("./engine.js") : null);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x) => (x == null || x === "" ? "" : String(Math.round(Number(x) * 10) / 10));
  const FAIL = /^(F|NP|U|W|FA|N)$/i;
  const box = (on) => (on ? "☑" : "☐");
  // 받침에 따라 조사 고르기: j("과목", "은/는")
  function j(word, pair) {
    const [a, b] = pair.split("/");
    const t = String(word).replace(/[\s)\]]+$/, "");
    const ch = t.charCodeAt(t.length - 1);
    let bat;
    if (ch >= 0xac00 && ch <= 0xd7a3) bat = (ch - 0xac00) % 28;
    else if (/[0-9]$/.test(t)) bat = "013678".includes(t.slice(-1)) ? 1 : 0;
    else bat = /[lmnr]$/i.test(t) ? 1 : 0;
    if (a === "으로") return word + (bat && bat !== 8 ? "으로" : "로");
    return word + (bat ? a : b);
  }

  // ---------- 과목별 이력 ----------
  /** 같은 과목의 모든 수강 기록(재수강·F 포함)을 모아 첫 수강과 인정 기록을 정리 */
  function history(raw) {
    const map = new Map();
    raw.forEach((c) => {
      const k = E.nkey(c.name).replace(/\([^)]*\)/g, "") || c.name;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    });
    const out = new Map();
    map.forEach((list) => {
      list.sort((a, b) => (E.termOrder(a.term) || 0) - (E.termOrder(b.term) || 0));
      const ok = list.filter((c) => !c.grade || !FAIL.test(c.grade));
      const counted = ok[ok.length - 1] || null;
      list.forEach((c) => out.set(c.id, { first: list[0], counted, attempts: list }));
    });
    return out;
  }

  function termLabel(c, hist) {
    const h = hist.get(c.id);
    if (!h) return c.term || "";
    const earlier = h.attempts.filter((a) => a !== h.counted && a.term && a.term !== h.counted.term).map((a) => a.term);
    return (c.term || "") + (earlier.length ? ` (${earlier.join(", ")})` : "");
  }

  function mscKind(name) {
    if (/물리|화학|생물|지구|천문|과학/.test(name)) return "과학(S)";
    if (/프로그래밍|코딩|SW|C$|-C|인공지능|빅데이터|컴퓨터|파이썬|전산/i.test(name) && !/이산수학|선형대수및|확률통계및/.test(name)) return "전산(C)";
    return "수학(M)";
  }

  // ---------- 선후수 ----------
  function prereqRows(rule, res, hist) {
    const d = rule.design || {};
    const taken = res.courses;
    const find = (n) => taken.find((c) => E.same(c.name, n));
    const firstTerm = (c) => { const h = hist.get(c.id); return h ? h.first.term : c.term; };
    const rows = [];
    const add = (pre, post, allowSame, kind) => {
      const b = find(post); if (!b) return;
      const a = find(pre);
      const ta = a ? E.termOrder(firstTerm(a)) : null, tb = E.termOrder(firstTerm(b));
      let ok = null, note = "";
      if (!a) { ok = false; note = "선수과목 미이수"; }
      else if (ta == null || tb == null) { ok = null; note = "학기 정보 없음"; }
      else ok = allowSame ? ta <= tb : ta < tb;
      if (a && ok && hist.get(a.id) && hist.get(a.id).attempts.length > 1) note = "재수강(최초 수강 기준)";
      if (ok === false && a) note = allowSame ? "선수과목을 나중에 수강" : "같은 학기 또는 나중에 수강";
      rows.push({ pre: a ? a.name : pre, preTerm: a ? firstTerm(a) : "", post: b.name, postTerm: firstTerm(b), ok, note, kind });
    };
    (rule.prereqs || []).forEach(([p, q]) => add(p, q, false, "지정"));
    const basic = taken.filter((c) => E.inList(c.name, d.basic));
    const caps = taken.filter((c) => E.inList(c.name, d.capstone));
    const elems = taken.filter((c) => c.area === "MAJOR" && !E.inList(c.name, d.basic) && !E.inList(c.name, d.capstone) && E.designCredit(rule, c.name) > 0);
    const b0 = basic[0] ? basic[0].name : (d.basic || [])[0];
    const claimed = new Set(res.designRows.filter((r) => r.counted).map((r) => E.nkey(r.name)));
    if (b0) {
      elems.filter((e) => claimed.has(E.nkey(e.name))).forEach((e) => add(b0, e.name, true, "설계"));
      caps.forEach((c) => add(b0, c.name, false, "설계"));
    }
    caps.forEach((c) => elems.filter((e) => claimed.has(E.nkey(e.name))).forEach((e) => add(e.name, c.name, true, "설계")));
    // 중복 제거
    const seen = new Set();
    return rows.filter((r) => { const k = r.pre + ">" + r.post; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- 상담표 ----------
  function consultSheet(rule, res, raw, info) {
    const hist = history(raw);
    const cur = info.currentTerm;
    const pre = prereqRows(rule, res, hist);
    const designRow = new Map(res.designRows.map((r) => [E.nkey(r.name), r]));
    const isNow = (c) => (cur && c.term === cur) || !c.grade;
    const cells = (c, withDesign) => {
      if (!c) return "<td></td>".repeat(8);
      const now = isNow(c);
      const dr = designRow.get(E.nkey(c.name));
      const prs = pre.filter((r) => r.kind === "지정" && E.same(r.post, c.name));
      const notes = [];
      if (c.how === "직접 지정") notes.push("영역 직접 지정");
      if (dr && !dr.counted) notes.push(`설계 미인정: ${dr.why}`);
      if (c.guess) notes.push("교과과정표 외 과목(확인 필요)");
      if (c.renamed) notes.push(`${c.name} 대체 인정(확인 필요)`);
      return `<td class="l">${esc((c.renamed ? c.origName : c.name))}</td><td>${now ? "" : fmt(c.credit)}</td><td>${now ? fmt(c.credit) : ""}</td>
        <td>${esc(termLabel(c, hist))}</td><td>${withDesign && dr ? (dr.counted ? fmt(dr.design) : "0") : ""}</td>
        <td class="l">${prs.map((p) => esc(p.pre)).join("<br>")}</td><td>${prs.map((p) => (p.ok == null ? "?" : p.ok ? "O" : "X")).join("<br>")}</td>
        <td class="l small">${esc(notes.join(" / "))}</td>`;
    };
    const by = (a) => res.courses.filter((c) => c.area === a).sort((x, y) => (E.termOrder(x.term) || 0) - (E.termOrder(y.term) || 0));
    const major = by("MAJOR");
    const m = rule.major || {};
    const blocks = [
      { label: "전문교양", need: fmt(rule.ge.min), groups: [{ name: "", list: by("GE") }] },
      { label: "MSC", need: fmt(rule.msc.min), groups: [{ name: "", list: by("MSC") }] },
      { label: "전공<br>(설계)", need: `${fmt(m.min)}(${fmt(m.designMin)})`, groups: [
        { name: "전공<br>주제", list: major.filter((c) => !designRow.has(E.nkey(c.name))) },
        { name: "설계", list: major.filter((c) => designRow.has(E.nkey(c.name))), design: true, hint: "설계학점은 기초 → 요소 → 종합 순서대로 수강해야 인정됨" },
      ] },
    ];
    let body = "";
    blocks.forEach((bl) => {
      const gRows = bl.groups.map((g) => Math.max(g.list.length, 1) + 1);
      const total = gRows.reduce((s, n) => s + n, 0) + 2;
      bl.groups.forEach((g, gi) => {
        const rows = [...g.list, null].concat(g.list.length ? [] : [null]);
        rows.forEach((c, ri) => {
          let lead = "";
          if (gi === 0 && ri === 0) lead += `<td class="cat" rowspan="${total}">${bl.label}</td><td class="cat" rowspan="${total}">${bl.need}</td>`;
          if (ri === 0) lead += `<td class="cat sub" rowspan="${gRows[gi]}">${g.name}${g.hint ? `<span class="hint-in">${esc(g.hint)}</span>` : ""}</td>`;
          body += `<tr class="${c ? "" : "blank"}">${lead}${cells(c, g.design)}</tr>`;
        });
      });
      const all = bl.groups.flatMap((g) => g.list);
      const past = all.filter((c) => !isNow(c)).reduce((s, c) => s + c.credit, 0);
      const now = all.filter(isNow).reduce((s, c) => s + c.credit, 0);
      const ds = bl.groups.some((g) => g.design) ? all.reduce((s, c) => { const r = designRow.get(E.nkey(c.name)); return s + (r && r.counted ? r.design : 0); }, 0) : "";
      body += `<tr class="subtotal"><td></td><td class="l">소계</td><td>${fmt(past)}</td><td>${fmt(now)}</td><td></td><td>${fmt(ds)}</td><td></td><td></td><td></td></tr>`;
      body += `<tr class="memo"><td class="l small" colspan="9">(비고 : 대체과목 인정 등 특이사항 기재)</td></tr>`;
    });
    return `
    <div class="sheet" id="sheetConsult">
      <div class="sheet-title">
        <h3>${esc(info.programName)} 프로그램 이수체계준수 상담표</h3>
        <div class="sheet-meta">작성일 <span class="fill">${esc(info.date)}</span> 학번 <span class="fill">${esc(info.sid)}</span> 이름 <span class="fill">${esc(info.name)}</span> (인)</div>
      </div>
      <table class="form">
        <colgroup><col style="width:7%"><col style="width:7%"><col style="width:6%"><col style="width:22%"><col style="width:7%"><col style="width:7%"><col style="width:11%"><col style="width:7%"><col style="width:11%"><col style="width:6%"><col></colgroup>
        <thead><tr><th>교과기준</th><th>이수 요구 학점(설계)</th><th colspan="2">표준이수 과목명</th><th>지난학기까지 이수학점</th><th>이번학기 수강학점</th><th>수강한 년도</th><th>설계 이수학점(이번학기 포함)</th><th>필수선수과목</th><th>선이수 여부(O,X)</th><th>비고</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="sheet-foot">※ 공학교육인증제 졸업 요건과 학과 졸업 요건은 상이함. 학과 졸업 요건 또한 충족해야 졸업이 가능함.</p>
    </div>`;
  }

  // ---------- 졸업심사서 ----------
  function reviewSheet(rule, res, raw, info) {
    const hist = history(raw);
    const by = (a) => res.courses.filter((c) => c.area === a).sort((x, y) => (E.termOrder(x.term) || 0) - (E.termOrder(y.term) || 0));
    const area = (id) => res.areas.find((a) => a.id === id);
    const chk = (g) => res.checks.filter((c) => c.group === g);
    const allOk = (g) => chk(g).every((c) => c.ok);
    const crit = (text, ok) => `<p class="crit">[ 인증기준 ] ${esc(text)} : 인증기준 ${box(ok)} 충족 ${box(!ok)} 미충족</p>`;
    const ge = rule.ge, msc = rule.msc, m = rule.major, d = rule.design || {};

    const geRows = by("GE").map((c) => `<tr><td>${E.inList(c.name, ge.required) ? "인증필수" : E.inList(c.name, ge.electives) ? "인증선택" : "전문교양"}</td><td class="l">${esc((c.renamed ? c.origName : c.name))}</td><td>${fmt(c.credit)}</td></tr>`).join("");
    const mscRows = by("MSC").map((c) => `<tr><td>${mscKind(c.name)}</td><td class="l">${esc((c.renamed ? c.origName : c.name))}</td><td>${fmt(c.credit)}</td></tr>`).join("");
    const extras = (rule.extra || []);
    const extraCols = extras.map((x) => x.label.replace(/\s*\d+.*$/, "").replace(/교과목|과목/g, "").trim() || x.label);
    const dmap = new Map(res.designRows.map((r) => [E.nkey(r.name), r]));
    const major = by("MAJOR");
    const dsg = major.filter((c) => dmap.has(E.nkey(c.name)));
    const plain = major.filter((c) => !dmap.has(E.nkey(c.name)));
    const mrow = (c, kind, i, n) => {
      const r = dmap.get(E.nkey(c.name));
      const cells = extras.map((x) => (E.inList(c.name, x.courses) ? fmt(x.minCredits ? c.credit : 1) : ""));
      return `<tr>${i === 0 ? `<td rowspan="${n}">${kind}</td>` : ""}<td class="l">${esc((c.renamed ? c.origName : c.name))}${r && !r.counted ? " *" : ""}</td><td>${fmt(c.credit)}</td><td>${r ? (r.counted ? fmt(r.design) : "0") : ""}</td>${cells.map((x) => `<td>${x}</td>`).join("")}</tr>`;
    };
    const tot = (f) => major.reduce((s, c) => s + (Number(f(c)) || 0), 0);
    const extraTot = extras.map((x) => major.reduce((s, c) => s + (E.inList(c.name, x.courses) ? (x.minCredits ? c.credit : 1) : 0), 0));
    const pre = prereqRows(rule, res, hist);

    const geText = `인증필수 ${ge.required.length}과목${ge.pickN ? `, 인증선택 ${ge.pickN}과목 이상` : ""} 포함 ${fmt(ge.min)}학점 이상 이수`;
    const mscText = `${msc.required.length ? "인증필수 교과목 포함 " : ""}${fmt(msc.min)}학점 이상 이수`;
    const capText = (d.capstone || []).length ? (d.capstoneAnyOf ? `${d.capstone.join("/")} 중 하나` : d.capstone.join(", ")) : "종합설계";
    return `
    <div class="sheet" id="sheetReview">
      <div class="sheet-title"><h3>공학교육인증 졸업심사서</h3><div class="sheet-meta">${esc(info.programName)} 프로그램</div></div>
      <h4>1. 심사대상 인적사항</h4>
      <table class="form"><thead><tr><th>학번</th><th>성명</th><th>졸업예정일</th><th>비고</th></tr></thead>
        <tbody><tr><td>${esc(info.sid)}</td><td>${esc(info.name)}</td><td>${esc(info.gradDate)}</td><td></td></tr></tbody></table>
      <h4>2. 과목이수 심사표</h4>
      <h5>(a) 전문교양</h5>
      <table class="form"><thead><tr><th style="width:18%">구분</th><th>교과목명</th><th style="width:14%">이수학점</th></tr></thead>
        <tbody>${geRows || '<tr class="blank"><td></td><td></td><td></td></tr>'}<tr class="subtotal"><td>총학점</td><td></td><td>${fmt(area("GE").earned)}</td></tr></tbody></table>
      ${crit(geText, area("GE").ok && allOk("GE"))}
      <h5>(b) MSC</h5>
      <table class="form"><thead><tr><th style="width:18%">구분</th><th>교과목명</th><th style="width:14%">이수학점</th></tr></thead>
        <tbody>${mscRows || '<tr class="blank"><td></td><td></td><td></td></tr>'}<tr class="subtotal"><td>총학점</td><td></td><td>${fmt(area("MSC").earned)}</td></tr></tbody></table>
      ${crit(mscText, area("MSC").ok && allOk("MSC"))}
      <h5>(c) 전공</h5>
      <table class="form"><thead><tr><th style="width:16%">구분</th><th>교과목명</th><th style="width:10%">이수학점</th><th style="width:10%">설계학점</th>${extraCols.map((x) => `<th style="width:11%">${esc(x)}</th>`).join("")}</tr></thead>
        <tbody>
          ${dsg.map((c, i) => mrow(c, "공학주제<br>(설계과목)", i, dsg.length)).join("")}
          ${plain.map((c, i) => mrow(c, "공학주제<br>(일반)", i, plain.length)).join("")}
          ${!major.length ? `<tr class="blank"><td></td><td></td><td></td><td></td>${extraCols.map(() => "<td></td>").join("")}</tr>` : ""}
          <tr class="subtotal"><td>총학점</td><td></td><td>${fmt(tot((c) => c.credit))}</td><td>${fmt(area("DESIGN").earned)}</td>${extraTot.map((x) => `<td>${fmt(x)}</td>`).join("")}</tr>
        </tbody></table>
      ${crit(`인증필수를 포함하여 ${fmt(m.min)}학점 이상 이수`, area("MAJOR").ok && allOk("MAJOR"))}
      ${crit(`기초설계 및 ${capText}를 포함하여 설계 ${fmt(m.designMin)}학점 이상 이수`, area("DESIGN").ok && allOk("DESIGN"))}
      ${extras.map((x, i) => crit(x.label, chk("EXTRA").filter((c) => c.label === x.label).every((c) => c.ok))).join("")}
      ${res.designRows.some((r) => !r.counted) ? '<p class="small">* 설계 순서 위반 등으로 설계학점이 인정되지 않는 과목</p>' : ""}
      <h5>(d) 이수체계 준수</h5>
      <table class="form"><thead><tr><th>선수교과목</th><th style="width:11%">이수 학년/학기</th><th>후수교과목</th><th style="width:11%">이수 학년/학기</th><th style="width:10%">선후수 준수여부</th><th style="width:20%">비고 (재수강, 준수 면제 확인 등)</th></tr></thead>
        <tbody>${pre.length ? pre.map((r) => `<tr><td class="l">${esc(r.pre)}</td><td>${esc(r.preTerm)}</td><td class="l">${esc(r.post)}</td><td>${esc(r.postTerm)}</td><td>${r.ok == null ? "?" : r.ok ? "○" : "X"}</td><td class="l small">${esc(r.note)}</td></tr>`).join("") : '<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody></table>
      <p class="crit">이수체계 준수: 인증기준 ${box(pre.every((r) => r.ok !== false))} 충족 ${box(pre.some((r) => r.ok === false))} 미충족</p>
      <p class="small">※ 이수한 교과목만 작성합니다. 선수과목을 재수강했다면 최초 수강 학기를 기준으로 판단합니다(최초 수강이 F여도 준수로 봄).</p>
    </div>`;
  }

  // ---------- 작성 팁 ----------
  function tips(rule, res, raw, info) {
    const hist = history(raw);
    const mine = [];
    const failed = raw.filter((c) => c.grade && FAIL.test(c.grade));
    const retaken = [...new Set([...hist.values()].filter((h) => h.attempts.length > 1 && h.counted).map((h) => h.counted))];
    const pre = prereqRows(rule, res, hist);
    const notCounted = res.designRows.filter((r) => !r.counted);
    const guesses = res.courses.filter((c) => c.guess);
    const now = res.courses.filter((c) => (info.currentTerm && c.term === info.currentTerm) || !c.grade);

    retaken.forEach((c) => {
      const h = [...hist.values()].find((x) => x.counted === c);
      mine.push(`<b>${esc(c.name)}</b>${j(c.name, "은/는").slice(c.name.length)} 재수강 과목입니다. 수강한 년도 칸에 <b>${esc(termLabel(c, hist))}</b>처럼 두 학기를 모두 적고, 학사정보시스템 ‘기이수성적조회’ 화면을 캡처해 함께 내세요.`);
    });
    failed.filter((f) => !res.courses.some((c) => E.same(c.name, f.name))).forEach((f) => mine.push(`<b>${esc(f.name)}</b>(${esc(f.grade)})${j(f.name, "은/는").slice(f.name.length)} 이수하지 못한 과목이라 체크표에 적지 않습니다.`));
    pre.filter((r) => r.ok === false && r.kind === "지정").forEach((r) => mine.push(`<b>${esc(r.pre)} → ${esc(r.post)}</b> 선후수 순서가 지켜지지 않았습니다(${esc(r.note)}). 선이수 여부에 X를 적고, <b>후수과목이수능력확인서</b>를 써서 ${esc(r.post)} 담당 교수님 서명을 받아 제출해야 합니다.`));
    notCounted.forEach((r) => mine.push(`<b>${esc(r.name)}</b>${j(r.name, "은/는").slice(r.name.length)} ${esc(r.why)}${/[가-힣]$/.test(r.why) && (r.why.charCodeAt(r.why.length - 1) - 0xac00) % 28 ? "이라서" : "라서"} 설계학점이 0으로 인정됩니다. 설계 이수학점 칸을 비우거나 0으로 적으세요.`));
    if (now.length) mine.push(`이번 학기 수강 중인 ${esc(j(now.map((c) => c.name).join(", "), "은/는"))} ‘이번학기 수강학점’ 칸에 적습니다. 성적이 나오기 전이라도 상담표에는 포함합니다.`);
    (res.renamed || []).forEach((x) => mine.push(`<b>${esc(x.from)}</b>${j(x.from, "은/는").slice(x.from.length)} ${esc(info.basis)}학번 기준의 <b>${esc(x.to)}</b>${j(x.to, "으로/로").slice(x.to.length)} 인정해 계산했습니다. 체크표에는 실제 들은 과목명을 적고 비고에 ‘${esc(x.to)} 대체’라고 적은 뒤, 학과 조교에게 인정 여부를 확인하세요.`));
    guesses.forEach((c) => mine.push(`<b>${esc(c.name)}</b>${j(c.name, "은/는").slice(c.name.length)} ${esc(info.basis)}학번 교과과정표에 없는 과목입니다. 대체과목으로 인정받는 경우에만 넣고, 비고에 ‘대체과목 인정’과 원래 과목명을 적으세요.`));
    const geEl = (rule.ge.electives || []).filter((n) => res.courses.some((c) => E.same(c.name, n)));
    if (rule.ge.pickN && geEl.length < rule.ge.pickN) mine.push(`전문교양 인증선택 과목(${(rule.ge.electives || []).join(", ")}) 중 ${rule.ge.pickN - geEl.length}과목이 더 필요합니다. 일반 균형교양은 인증선택으로 인정되지 않습니다.`);

    const general = [
      "졸업심사서는 <b>수기 작성</b>이 원칙입니다. 이 미리보기를 보고 학과에서 받은 공식 양식에 옮겨 적으세요.",
      "본인 <b>입학 연도</b>의 인증요건을 기준으로 하되, 공학교육센터에 게시된 최신 요건을 확인하세요. 같은 과목도 학번에 따라 학점이 다를 수 있습니다.",
      "<b>설계학점은 성적증명서에 나오지 않습니다.</b> 이수체계표의 학점(설계) 괄호 숫자를 보고 직접 적습니다.",
      "설계 과목은 <b>기초 → 요소 → 종합</b> 순서로 들어야 인정됩니다. 기초+요소, 요소+종합은 같은 학기에 들어도 됩니다.",
      "<b>F 받은 과목은 적지 않습니다.</b> 재수강해서 통과했다면 재수강 학기와 처음 수강 학기를 함께 적습니다. 예: 2021-1 (2020-1)",
      "들은 전공 과목은 요건을 넘더라도 <b>모두</b> 적습니다. 실험·실습 학점이 있는 과목은 학점 옆 괄호에 표시합니다. 예: 3(1)",
      "대체과목, 확인서 제출 같은 특이사항은 각 영역 아래 <b>비고</b> 줄에 적습니다.",
      "공학인증 졸업요건과 <b>학과 졸업요건(130학점 등)은 별개</b>입니다. 둘 다 채워야 졸업할 수 있습니다.",
      "종합설계(캡스톤) 결과보고서는 4학년 2학기 졸업심사 때 제출하므로 졸업 때까지 보관하세요.",
      "3학년 2학기에 공학인증 <b>확약서 또는 포기서</b>를 내야 합니다. 포기는 복수전공·교직 등 정해진 사유가 있을 때만 가능합니다.",
    ];
    const docs = [
      "졸업심사서(수기)", "후수과목이수능력확인서(선후수 미준수 시)", "인증시험 답안지", "졸업예정자 설문조사",
      "개인정보 수집·이용 동의서 2부", "표준이수체계(준수)표", "성적증명서 국문 원본 1부", "졸업예정증명서 국문 원본 1부",
      "종합설계 결과보고서", "재수강 이력 캡처(해당자)", "구비서류 체크리스트(맨 앞)",
    ];
    return { mine, general, docs };
  }

  function csv(rule, res, raw, info) {
    const hist = history(raw);
    const designRow = new Map(res.designRows.map((r) => [E.nkey(r.name), r]));
    const lines = [["교과기준", "과목명", "지난학기까지 이수학점", "이번학기 수강학점", "수강한 년도", "설계 이수학점"]];
    ["GE", "MSC", "MAJOR"].forEach((a) => res.courses.filter((c) => c.area === a).forEach((c) => {
      const now = (info.currentTerm && c.term === info.currentTerm) || !c.grade;
      const dr = designRow.get(E.nkey(c.name));
      lines.push([{ GE: "전문교양", MSC: "MSC", MAJOR: "전공" }[a], c.name, now ? "" : c.credit, now ? c.credit : "", termLabel(c, hist), dr ? (dr.counted ? dr.design : 0) : ""]);
    }));
    return "﻿" + lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  }

  const api = { consultSheet, reviewSheet, tips, prereqRows, history, csv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SHEET = api;
})(typeof self !== "undefined" ? self : this);
