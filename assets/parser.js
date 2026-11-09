/* 성적증명서·기이수성적 텍스트 → 과목 목록 */
(function (root) {
  "use strict";
  const E = root.ABEEK || (typeof require !== "undefined" ? require("./engine.js") : null);

  const GRADE = /^(A\+|A0|A|A-|B\+|B0|B|B-|C\+|C0|C|C-|D\+|D0|D|D-|F|P|NP|S|U|W|PASS|FAIL)$/i;
  const CAT = /^(교필|교선|교양|공필|균필|기필|학기|학기교|전필|전선|전기|전공|전공필수|전공선택|전공기초|교직|일선|자선|복필|복선|부필|부선|연필|연선|교양필수|교양선택|기초교양|학문기초|균형교양|공통교양|핵심교양|교과|자유선택)[0-9]?$/;
  const TERM = /(?<!\d)((?:19|20)\d{2})(?!\d)\s*(?:학년도|년도|년)?\s*[-.\/]?\s*(?:제\s*)?(1|2|하계|동계|여름|겨울)(?!\d)\s*(?:학기)?/;

  function normLine(s) { return String(s).replace(/\u00a0/g, " ").replace(/[|│┃¦]/g, " ").replace(/\t+/g, "\t").trim(); }

  /** 글자 인식(OCR) 결과에서 흔한 등급 오인식 바로잡기 */
  function fixGrade(t, afterCredit) {
    const u = t.replace(/[＋十÷†]/g, "+").replace(/[‐–—−]/g, "-").toUpperCase();
    if (GRADE.test(u)) return u;
    if (afterCredit) {
      if (/^([4ДΛㅅ]|\/ㅅ|\/\\|\/[\\Λ])[0OD]$/.test(u) || /^A[OD]$/.test(u)) return "A0";
      if (/^(8|B)[OD]$/.test(u)) return "B0";
      if (/^C[OD]$/.test(u)) return "C0";
      if (/^FF?$/.test(u)) return "F";
      if (/^[4ДΛ]\+$/.test(u)) return "A+";
    }
    let m = u.match(/^([ABCD8])([+T0O]?)$/);
    if (m) { const L = m[1] === "8" ? "B" : m[1]; const s = m[2] === "T" ? "+" : m[2] === "O" ? "0" : m[2]; return L + s; }
    if (/^(PASS|P|NP|F)$/.test(u)) return u;
    return null;
  }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  /** 이미 알고 있는 과목명 중 문자열 안에 들어 있는 가장 긴 것, 없으면 비슷한 이름(오인식 보정) */
  function knownIn(text, known, fuzzy) {
    const k = E.nkey(text);
    let best = null;
    if (fuzzy !== "only") for (const n of known) {
      const nk = E.nkey(n);
      if (nk.length >= 3 && k.includes(nk) && (!best || nk.length > E.nkey(best).length)) best = n;
    }
    if (best || !fuzzy || k.length < 3) return best;
    if (k.length >= 6) {
      // 앞뒤가 잘린 과목명: 아는 과목명 안에 통째로 들어 있으면 그 과목
      const hit = known.filter((n) => { const nk = E.nkey(n); return nk.includes(k) && k.length >= 0.55 * nk.length; });
      if (hit.length === 1) return hit[0];
    }
    let bd = 99;
    for (const n of known) {
      const nk = E.nkey(n);
      if (nk.length < 3) continue;
      const dd = lev(k, nk);
      if (dd < bd && dd <= Math.max(1, Math.floor(nk.length * 0.25))) { bd = dd; best = n; }
    }
    return best;
  }

  /**
   * 한 줄에서 과목들을 뽑는다. 두 단이 한 줄로 합쳐진 경우를 위해 등급이 나올 때마다 끊어서 처리.
   * 반환: 과목 배열 (없으면 빈 배열)
   */
  function parseLineAll(line, ctx, known, opts) {
    line = normLine(line);
    if (!line) return [];
    const fuzzy = opts && opts.fuzzy;
    if (fuzzy) line = line.replace(/제\s*[\]lI!\[]\s*학기/g, "제1학기").replace(/제\s*[zZ]\s*학기/g, "제2학기").replace(/\s+、\s+/g, " ");
    const toks = line.split(/\t|\s+/).map((t) => t.trim()).filter(Boolean);
    const grades = toks.map((t, i) => {
      const g = fuzzy ? fixGrade(t, i > 0 && /^\d(\.\d)?$/.test(toks[i - 1])) : (GRADE.test(t) ? t.toUpperCase() : null);
      // 한 글자 등급(A, B, P…)은 앞에 학점 숫자가 있을 때만 등급으로 본다
      if (g && /^[ABCDFPSUW]$/.test(g) && !(i > 0 && /^\d(\.\d)?$/.test(toks[i - 1]))) return null;
      return g;
    });
    const out = [];
    let start = 0;
    for (let g = 0; g < toks.length; g++) {
      if (!grades[g]) continue;
      // 등급 뒤 평점(4.5 등)은 같은 묶음
      let end = g + 1;
      if (end < toks.length && /^[0-4](\.\d{1,2})?$/.test(toks[end]) && !grades[end] && toks[end].includes(".")) end++;
      const seg = toks.slice(start, end);
      const segText = seg.join(" ");
      const tm = segText.match(TERM);
      if (tm) ctx.term = `${tm[1]}-${tm[2]}`;
      const gi = g - start;
      let credit = null, ci = -1;
      for (let i = gi - 1; i >= 0; i--) {
        const m = seg[i].match(/^(\d(?:\.\d)?)$/);
        if (m && Number(m[1]) > 0 && Number(m[1]) <= 6) { credit = Number(m[1]); ci = i; break; }
      }
      if (credit != null) {
        const head = seg.slice(0, ci).join(" ");
        const cat = seg.find((t) => CAT.test(t)) || "";
        const parts = seg.slice(0, ci).filter((t) => !CAT.test(t) && !/^\d+(\.\d+)?$/.test(t) && !/^[A-Z]{0,4}\d{4,}(-\d+)?$/.test(t) && !TERM.test(t) && !/^(제?\d학기|학기|학년도|년도|\d{4}학년도)$/.test(t));
        let raw = parts.join(" ").replace(/^\d+\s*/, "").replace(/^[^가-힣A-Za-z]+/, "").trim();
        if (fuzzy) raw = raw.replace(/^[A-Za-z]{1,3}\s+(?=[가-힣])/, "").replace(/^(\S{1,2}\s+)+(?=\S{3,})/, "");
        const exact = knownIn(head, known, false);
        const rk = E.nkey(raw).length || 1;
        let name = exact && E.nkey(exact).length >= 0.75 * rk ? exact : (fuzzy && knownIn(raw, known, "only")) || exact || raw;
        if (name.length <= 40)
          out.push({ name: /[가-힣A-Za-z]{2,}/.test(name) ? name : "", credit, grade: grades[g], cat, term: tm ? `${tm[1]}-${tm[2]}` : ctx.term || "" });
      }
      start = end; g = end - 1;
    }
    if (!out.length) {
      const tm = line.match(TERM);
      if (tm && line.length < 60) ctx.term = `${tm[1]}-${tm[2]}`;
    }
    return out;
  }

  function parseLine(line, ctx, known) { return parseLineAll(line, ctx, known).filter((c) => c.name)[0] || null; }

  const HEADER = /교과목명|이수구분|^구분|학점|성적|평점|신청|취득|평균|합계|증명|총장|학번|성명|소속|생년|페이지|^\d+\s*\/\s*\d+$/;
  /** 과목 줄이 아닌, 칸 안에서 줄바꿈된 과목명 조각일 수 있는 줄 */
  function isFragment(ln) {
    const t = normLine(ln);
    return t && t.length <= 30 && /[가-힣A-Za-z()]/.test(t) && !TERM.test(t) && !HEADER.test(t);
  }

  const frag = (ln) => normLine(ln).split(/\t|\s+/).filter((t) => !CAT.test(t)).join("") || null;

  function parseText(text, known, opts) {
    const ctx = { term: "" };
    const fuzzy = opts && opts.fuzzy;
    const lines = String(text).split(/\r?\n/).map((ln) => {
      // CSV 한 줄이면 탭처럼
      if (/,/.test(ln) && !/\t/.test(ln) && ln.split(",").length >= 4) ln = ln.split(",").map((x) => x.replace(/^"|"$/g, "")).join("\t");
      return ln;
    });
    const per = lines.map((ln) => parseLineAll(ln, ctx, known, opts));
    const used = new Set();
    const out = [];
    per.forEach((list, i) => {
      list.forEach((c) => {
        const isKnown = (n) => knownIn(n, known, fuzzy);
        const prev = i > 0 && !per[i - 1].length && !used.has(i - 1) && isFragment(lines[i - 1]) ? frag(lines[i - 1]) : null;
        const next = i + 1 < lines.length && !per[i + 1].length && !used.has(i + 1) && isFragment(lines[i + 1]) ? frag(lines[i + 1]) : null;
        const known0 = c.name && isKnown(c.name) && E.nkey(isKnown(c.name)) === E.nkey(c.name);
        if (!known0 && (prev || next)) {
          // 칸 안에서 줄바꿈된 과목명: 앞뒤 조각을 붙여서 아는 과목명이 되는지 본다
          const cands = [
            [prev, c.name, next], [prev, c.name], [c.name, next], [prev, next],
          ].filter((a) => a.some(Boolean)).map((a) => ({ parts: a, text: a.filter(Boolean).join("") }));
          let pick = cands.find((x) => { const k = isKnown(x.text); return k && E.nkey(k).length >= E.nkey(x.text).length - 2; });
          if (!pick && !c.name) pick = cands.find((x) => x.parts[0] === prev && x.parts[2] === next) || cands[cands.length - 1];
          if (pick) {
            const k = isKnown(pick.text);
            c.name = k || pick.text.replace(/\s+/g, "");
            if (pick.parts[0] && pick.parts[0] === prev) used.add(i - 1);
            if (pick.parts[pick.parts.length - 1] && pick.parts[pick.parts.length - 1] === next) used.add(i + 1);
          }
        }
        if (c.name) out.push(c);
      });
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

  const api = { fixGrade, knownIn, parseLineAll, parseRows, parseText, parseLine, pdfItemsToText, parsePdf, GRADE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TRANSCRIPT = api;
})(typeof self !== "undefined" ? self : this);
