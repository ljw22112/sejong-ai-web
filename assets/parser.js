/* 성적증명서·기이수성적 텍스트 → 과목 목록 */
(function (root) {
  "use strict";
  const E = root.ABEEK || (typeof require !== "undefined" ? require("./engine.js") : null);

  const GRADE = /^(A\+|A0|A|A-|B\+|B0|B|B-|C\+|C0|C|C-|D\+|D0|D|D-|F|P|NP|S|U|W|PASS|FAIL)$/i;
  const CAT = /^(교필|교선|교양|공필|균필|기필|학기|학기교|전필|전선|전기|전공|전공필수|전공선택|전공기초|교직|일선|자선|복필|복선|부필|부선|연필|연선|교양필수|교양선택|기초교양|학문기초|균형교양|공통교양|핵심교양)[0-9]?$/;
  const TERM = /(?<!\d)((?:19|20)\d{2})(?!\d)\s*(?:학년도|년도|년)?\s*[-.\/]?\s*(1|2|하계|동계|여름|겨울)(?!\d)\s*(?:학기)?/;

  function normLine(s) { return String(s).replace(/ /g, " ").replace(/\t+/g, "\t").trim(); }

  /** 이미 알고 있는 과목명 중 줄 안에 들어 있는 가장 긴 것 */
  function knownIn(line, known) {
    const k = E.nkey(line);
    let best = null;
    for (const n of known) {
      const nk = E.nkey(n);
      if (nk.length >= 3 && k.includes(nk) && (!best || nk.length > E.nkey(best).length)) best = n;
    }
    return best;
  }

  /** 한 줄(또는 한 칸 묶음)에서 과목 하나를 뽑는다. 없으면 null */
  function parseLine(line, ctx, known) {
    line = normLine(line);
    if (!line) return null;
    const tm = line.match(TERM);
    const toks = line.split(/\t|\s{2,}|\s/).map((t) => t.trim()).filter(Boolean);
    const gi = toks.map((t, i) => (GRADE.test(t) ? i : -1)).filter((i) => i >= 0);
    if (!gi.length) {
      if (tm && !/[A-F][+0]?\s*$/.test(line) && line.length < 40) ctx.term = `${tm[1]}-${tm[2]}`;
      return null;
    }
    const g = gi[gi.length - 1];
    // 학점: 등급 앞쪽에서 가장 가까운 0.5~6 숫자
    let credit = null, ci = -1;
    for (let i = g - 1; i >= 0; i--) {
      const m = toks[i].match(/^(\d(?:\.\d)?)$/);
      if (m && Number(m[1]) > 0 && Number(m[1]) <= 6) { credit = Number(m[1]); ci = i; break; }
    }
    if (credit == null) {
      for (let i = g + 1; i < toks.length; i++) { const m = toks[i].match(/^(\d(?:\.\d)?)$/); if (m && +m[1] > 0 && +m[1] <= 6) { credit = +m[1]; ci = i; break; } }
    }
    if (credit == null) return null;
    const cat = toks.find((t) => CAT.test(t)) || "";
    let name = knownIn(line, known);
    if (!name) {
      const skip = new Set([g, ci]);
      const parts = toks.filter((t, i) => !skip.has(i) && !CAT.test(t) && !GRADE.test(t) && !/^\d+(\.\d+)?$/.test(t) && !/^[A-Z]{0,4}\d{4,}(-\d+)?$/.test(t) && !TERM.test(t) && !/^(학기|학년도|년도)$/.test(t));
      // 한글이 있는 연속 토큰 묶음을 과목명으로
      name = parts.join(" ").replace(/^\d+\s*/, "").trim();
      if (!/[가-힣A-Za-z]{2,}/.test(name) || name.length > 40) return null;
    }
    return { name, credit, grade: toks[g].toUpperCase(), cat, term: tm ? `${tm[1]}-${tm[2]}` : ctx.term || "" };
  }

  function parseText(text, known) {
    const ctx = { term: "" };
    const out = [];
    String(text).split(/\r?\n/).forEach((ln) => {
      // CSV 한 줄이면 탭처럼
      if (/,/.test(ln) && !/\t/.test(ln) && ln.split(",").length >= 4) ln = ln.split(",").map((x) => x.replace(/^"|"$/g, "")).join("\t");
      const c = parseLine(ln, ctx, known);
      if (c) out.push(c);
    });
    return out;
  }

  /** pdf.js 의 text item 들을 줄 → 단(column) 단위 텍스트로 재구성 */
  function pdfItemsToText(pages) {
    const blocks = [];
    pages.forEach((items) => {
      const its = items.filter((t) => t.str && t.str.trim()).map((t) => ({ s: t.str, x: t.transform[4], y: t.transform[5], w: t.width || 0 }));
      if (!its.length) return;
      // 등급 토큰의 x 좌표로 단 경계를 추정 (성적증명서는 보통 2~3단)
      // '학점 등급'이 나란히 있는 위치만 등급 칸으로 본다 (과목명 속 C, S 같은 글자 배제)
      const gx = its.filter((t) => GRADE.test(t.s.trim()) && its.some((u) => u !== t && Math.abs(u.y - t.y) < 3 && u.x < t.x && t.x - u.x < 80 && /^\d(\.\d)?$/.test(u.s.trim())))
        .map((t) => t.x).sort((a, b) => a - b);
      const cols = [];
      gx.forEach((x) => { if (!cols.length || x - cols[cols.length - 1].x > 120) cols.push({ x, n: 1 }); else { const c = cols[cols.length - 1]; c.x = (c.x * c.n + x) / (c.n + 1); c.n++; } });
      const strong = cols.filter((c) => c.n >= 2);
      const bounds = strong.slice(0, -1).map((c) => c.x + 25);
      const colOf = (x) => { let i = 0; while (i < bounds.length && x > bounds[i]) i++; return i; };
      const ncol = bounds.length + 1;
      for (let c = 0; c < ncol; c++) {
        const mine = its.filter((t) => colOf(t.x) === c).sort((a, b) => b.y - a.y || a.x - b.x);
        const lines = [];
        mine.forEach((t) => {
          const L = lines.find((l) => Math.abs(l.y - t.y) < 3.2);
          if (L) L.items.push(t); else lines.push({ y: t.y, items: [t] });
        });
        lines.sort((a, b) => b.y - a.y);
        blocks.push(lines.map((l) => {
          l.items.sort((a, b) => a.x - b.x);
          let s = "", px = null;
          l.items.forEach((t) => { if (px != null) s += t.x - px > 6 ? "\t" : (t.x - px > 1.5 ? " " : ""); s += t.s; px = t.x + t.w; });
          return s;
        }).join("\n"));
      }
    });
    return blocks.join("\n");
  }

  async function parsePdf(file, pdfjsLib) {
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p);
      const tc = await pg.getTextContent();
      pages.push(tc.items);
    }
    return pdfItemsToText(pages);
  }

  /** 엑셀(학사정보시스템 기이수성적 등) 행 배열 → 과목 목록. 머리글을 찾아 칸을 맞추고, 못 찾으면 텍스트로 처리 */
  function parseRows(rows, known) {
    const norm = (v) => String(v ?? "").replace(/\s+/g, "");
    const hi = rows.findIndex((r) => r.some((v) => /^(교과목명|과목명|교과목)$/.test(norm(v))) && r.some((v) => /^학점$/.test(norm(v))));
    if (hi < 0) return parseText(rows.map((r) => r.map((v) => String(v ?? "")).join("\t")).join("\n"), known);
    const h = rows[hi].map(norm);
    const col = (re) => h.findIndex((v) => re.test(v));
    const cY = col(/^(년도|학년도|수강년도|이수년도)$/), cS = col(/^(학기|수강학기|이수학기)$/), cT = col(/^(학기구분|년도학기|수강학기)$/);
    const cN = col(/^(교과목명|과목명|교과목)$/), cC = col(/^(이수구분|구분)$/), cCr = col(/^학점$/), cG = col(/^(등급|성적|평가등급)$/);
    const out = [];
    let lastY = "", lastS = "";
    rows.slice(hi + 1).forEach((r) => {
      const name = String(r[cN] ?? "").trim();
      const credit = Number(String(r[cCr] ?? "").replace(/[^0-9.]/g, ""));
      if (!name || !credit || credit > 6 || /합계|소계|총계|평점평균/.test(name)) return;
      let y = cY >= 0 ? String(r[cY] ?? "").trim() : "", sm = cS >= 0 ? String(r[cS] ?? "").trim() : "";
      if (cT >= 0 && (!y || !sm)) { const m = String(r[cT] ?? "").match(TERM); if (m) { y = m[1]; sm = m[2]; } }
      y = y || lastY; sm = sm || lastS; lastY = y; lastS = sm;
      const smm = sm.match(/(1|2|하계|동계|여름|겨울)/);
      const grade = String(r[cG] ?? "").trim().toUpperCase();
      out.push({ name, credit, grade: GRADE.test(grade) ? grade : grade ? grade : "", cat: cC >= 0 ? String(r[cC] ?? "").trim() : "", term: /^\d{4}$/.test(y) && smm ? `${y}-${smm[1]}` : "" });
    });
    return out;
  }

  const api = { parseRows, parseText, parseLine, pdfItemsToText, parsePdf, GRADE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TRANSCRIPT = api;
})(typeof self !== "undefined" ? self : this);
