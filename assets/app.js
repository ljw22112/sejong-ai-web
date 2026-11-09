/* 화면 로직 */
(function () {
  "use strict";
  const E = window.ABEEK, P = window.TRANSCRIPT, C = window.CAREERS, SH = window.SHEET;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const AREA_LABEL = { GE: "전문교양", MSC: "MSC(BSM)", MAJOR: "전공", OTHER: "인증 영역 아님" };
  const GROUP_LABEL = { GE: "전문교양", MSC: "MSC", MAJOR: "전공", DESIGN: "설계", EXTRA: "추가 조건" };
  const FAMILY_ORDER = ["sw", "robot", "ee", "mech", "aero", "nano", "nuclear", "civil", "arch", "env", "energy"];

  let DATA = null, KNOWN = [], GRADD = null, OFFERED = null, SEASON = null;
  const GR = window.GRAD;
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

    if (DATA.updated) $("#stamp").textContent = `요건 기준 ${DATA.updated.replace(/-/g, ".")} · 매 학기 공학교육센터 요건 자동 확인`;
    // 부가 데이터: 없어도 동작
    const opt = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [GRADD, OFFERED, SEASON] = await Promise.all([opt("data/grad.json"), opt("data/offered.json"), opt("data/season.json")]);
    opt("data/notices.json").then((n) => {
      if (!n || !n.items || !n.items.length) return;
      $("#notices").innerHTML = n.items.slice(0, 4).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="date">${esc(x.date)}</span></li>`).join("");
      $("#noticeBox").hidden = false;
    });
    const saved = store.load();
    if (saved && saved.courses) Object.assign(S, saved);
    fillPrograms();
    if (!S.program) S.program = "03";
    syncSelects();
    bind();
    if (S.courses.length) render();
  }

  const prog = () => DATA.programs[S.program];
  const latestYear = () => Object.keys(prog().years).sort().pop();
  /** 공학교육센터 안내: 교과목은 입학 연도 기준, 최소이수학점은 최신 연도 기준 */
  const rule = () => {
    const p = prog();
    const admitR = p.years[S.admit] || p.years[latestYear()];
    if (S.basis === "latest") {
      const L = p.years[latestYear()];
      if (!L || L === admitR) return admitR;
      return Object.assign({}, admitR, {
        ge: Object.assign({}, admitR.ge, { min: L.ge.min }),
        msc: Object.assign({}, admitR.msc, { min: L.msc.min }),
        major: Object.assign({}, admitR.major, { min: L.major.min, designMin: L.major.designMin }),
        totalMin: L.totalMin, mergedFrom: latestYear(),
      });
    }
    return p.years[S.basis] || admitR;
  };
  const basisLabel = () => (S.basis === "latest" ? `${S.admit}학번 과목 · ${latestYear()}년 최소학점 기준` : `${S.basis}년 공학인증요건 기준`);

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
    if (S.basis !== "latest" && !later.includes(S.basis)) S.basis = "latest";
    $("#basis").innerHTML = `<option value="latest">최신 최소학점 + 내 학번 과목 (권장)</option>` + later.map((y) => `<option value="${y}">${y === S.admit ? "입학 연도 기준 그대로" : `${y}년 기준 그대로`}</option>`).join("");
    $("#basis").value = S.basis;
    const notes = [];
    if (S.autoProgram) notes.push("성적표 과목으로 학과를 추정했습니다. 다르면 바꿔 주세요.");
    if (p.status) notes.push(p.status);
    if (S.basis === "latest") notes.push(`공학교육센터 안내대로 교과목은 ${S.admit}학번 기준, 최소이수학점은 최신(${latestYear()}년) 기준으로 계산합니다.`);
    else if (S.basis !== S.admit) notes.push("다른 연도 기준 적용 가능 여부는 공학교육센터에 확인하세요.");
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
  function accept(list, source, rawText) {
    const st = $("#readStatus");
    if (!list.length) {
      st.textContent = `${source}에서 과목을 찾지 못했습니다. 아래 ‘읽은 글자’를 확인하고 붙여넣기 칸에서 고쳐 읽거나, 기이수성적 엑셀을 넣어 보세요.`;
      st.className = "status err";
      showRaw(rawText);
      return;
    }
    showRaw("");
    S.courses = list.map((c, i) => Object.assign({ id: Date.now() + "-" + i }, c));
    const a = guessAdmit(S.courses);
    if (a) S.admit = a;
    const g = guessProgram(S.courses);
    if (g) { S.program = g; S.autoProgram = true; }
    S.basis = null; S.next = null; S.planned = []; S.exclude = [];
    st.textContent = list.some((c) => c.ocr)
      ? `${source}에서 글자 인식으로 ${list.length}과목을 읽었습니다. 인식이 틀릴 수 있으니 ‘읽어 들인 과목’ 표를 한 번 확인해 주세요.`
      : `${source}에서 ${list.length}과목을 읽었습니다.`;
    st.className = "status";
    syncSelects();
    render();
  }

  // ---------- 글자 인식(OCR): 이미지형 PDF·사진. 브라우저 안에서 실행 ----------
  let tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessLoading) tessLoading = new Promise((ok, no) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      sc.onload = () => ok(window.Tesseract);
      sc.onerror = () => { tessLoading = null; no(new Error("글자 인식 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.")); };
      document.head.appendChild(sc);
    });
    return tessLoading;
  }

  /** 글자 인식 전처리: 크기 키우기, 흑백, 표 선 지우기 */
  async function prep(src) {
    let w, h, draw;
    if (src instanceof HTMLCanvasElement) { w = src.width; h = src.height; draw = (ctx, W, H) => ctx.drawImage(src, 0, 0, W, H); }
    else { const bm = await createImageBitmap(src); w = bm.width; h = bm.height; draw = (ctx, W, H) => ctx.drawImage(bm, 0, 0, W, H); }
    const k = w < 2200 ? 2200 / w : 1;
    const W = Math.round(w * k), H = Math.round(h * k);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high"; draw(ctx, W, H);
    const img = ctx.getImageData(0, 0, W, H), px = img.data;
    const dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dark[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) < 165 ? 1 : 0;
    // 가로선: 한 줄에 어두운 칸이 길게 이어지면 지움
    const runH = Math.max(120, W * 0.12);
    for (let y = 0; y < H; y++) {
      let run = 0;
      for (let x = 0; x <= W; x++) {
        if (x < W && dark[y * W + x]) run++;
        else { if (run >= runH) for (let xx = x - run; xx < x; xx++) dark[y * W + xx] = 2; run = 0; }
      }
    }
    // 세로선: 글자 높이보다 훨씬 길게 이어지면 지움
    const runV = Math.max(40, Math.round(W * 0.02));
    for (let x = 0; x < W; x++) {
      let run = 0;
      for (let y = 0; y <= H; y++) {
        if (y < H && dark[y * W + x] === 1) run++;
        else { if (run >= runV) for (let yy = y - run; yy < y; yy++) dark[yy * W + x] = 2; run = 0; }
      }
    }
    for (let i = 0; i < W * H; i++) { const v = dark[i] === 1 ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function crop(cv, x0, x1) {
    const c = document.createElement("canvas");
    c.width = Math.round(x1 - x0); c.height = cv.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(cv, x0, 0, c.width, cv.height, 0, 0, c.width, cv.height);
    return c;
  }

  async function ocr(images, st) {
    const T = await loadTesseract();
    let page = 0, total = images.length;
    const worker = await T.createWorker(["kor", "eng"], 1, {
      logger: (m) => {
        if (m.status === "recognizing text") st.textContent = `글자 인식 중 ${page}/${total} · ${Math.round(m.progress * 100)}%`;
        else if (/loading|initializ/.test(m.status)) st.textContent = "글자 인식 준비 중 (처음 한 번은 10~20초 걸립니다)…";
      },
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const run = async (cv, psm) => { await worker.setParameters({ tessedit_pageseg_mode: String(psm) }); return (await worker.recognize(cv)).data.text; };
    let full = "", halves = "";
    const preps = [];
    for (const img of images) preps.push(await prep(img));
    for (const cv of preps) { page++; full += (await run(cv, 3)) + "\n"; }
    // 두 단 증명서: 왼쪽·오른쪽을 따로 읽은 결과가 더 많으면 그쪽을 쓴다
    if (P.parseText(full, KNOWN, { fuzzy: true }).length < 8) {
      total = preps.length * 2; page = 0;
      for (const cv of preps) {
        page++; halves += (await run(crop(cv, 0, cv.width / 2), 6)) + "\n";
        page++; halves += (await run(crop(cv, cv.width / 2, cv.width), 6)) + "\n";
      }
    }
    await worker.terminate();
    const a = P.parseText(full, KNOWN, { fuzzy: true }).length, b = halves ? P.parseText(halves, KNOWN, { fuzzy: true }).length : -1;
    return b > a ? halves : full;
  }

  async function pdfPages(file) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error("PDF 해석기를 불러오지 못했습니다. 인터넷 연결을 확인하거나 표를 붙여넣어 주세요.");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    let doc;
    try {
      doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw new Error("암호가 걸린 PDF입니다. 암호를 풀어 저장하거나, 화면을 캡처한 이미지를 넣어 주세요.");
      throw new Error("PDF를 열지 못했습니다. 파일이 손상되었거나 보호된 문서일 수 있습니다. 화면 캡처 이미지나 기이수성적 엑셀을 넣어 주세요.");
    }
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) items.push((await (await doc.getPage(p)).getTextContent()).items);
    const render = async () => {
      const out = [];
      for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
        const pg = await doc.getPage(p);
        const vp = pg.getViewport({ scale: 3 });
        const cv = document.createElement("canvas");
        cv.width = vp.width; cv.height = vp.height;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        out.push(cv);
      }
      return out;
    };
    return { text: P.pdfItemsToText(items), render };
  }

  function showRaw(text) {
    const box = $("#rawBox");
    if (!text || !text.trim()) { box.hidden = true; return; }
    box.hidden = false;
    $("#rawText").textContent = text.slice(0, 4000);
    $("#rawToPaste").onclick = () => {
      $("#paste").value = text;
      $("#paste").closest("details").open = true;
      $("#paste").focus();
    };
  }

  async function readFile(file) {
    const st = $("#readStatus");
    st.className = "status"; st.textContent = `${file.name} 읽는 중…`;
    showRaw("");
    let lastText = "";
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const pdf = await pdfPages(file);
        lastText = pdf.text;
        let list = P.parseText(pdf.text, KNOWN);
        const hangul = (pdf.text.match(/[가-힣]/g) || []).length;
        if (list.length < 3) {
          // 글자 정보가 없거나 글꼴이 깨진 증명서(이미지형)는 화면을 그려서 글자 인식
          st.textContent = hangul < 20 ? "글자 정보가 없는 PDF라서 화면 글자를 인식합니다…" : "글자가 제대로 읽히지 않아 화면 글자를 인식합니다…";
          const text = await ocr(await pdf.render(), st);
          lastText = text;
          const got = P.parseText(text, KNOWN, { fuzzy: true });
          if (got.length > list.length) list = got;
          if (list.length) list.forEach((c) => (c.ocr = true));
        }
        accept(list, file.name, lastText);
        return;
      }
      if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name) || /^image\//.test(file.type)) {
        const text = await ocr([file], st);
        lastText = text;
        const list = P.parseText(text, KNOWN, { fuzzy: true });
        list.forEach((c) => (c.ocr = true));
        accept(list, file.name, lastText);
        return;
      }
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (!window.XLSX) throw new Error("엑셀 해석기를 불러오지 못했습니다. 인터넷 연결을 확인하거나 표를 붙여넣어 주세요.");
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
        let best = [];
        wb.SheetNames.forEach((n) => {
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
          lastText += rows.map((r) => r.join("\t")).join("\n") + "\n";
          const got = P.parseRows(rows, KNOWN);
          if (got.length > best.length) best = got;
        });
        accept(best, file.name, lastText);
        return;
      }
      lastText = await file.text();
      accept(P.parseText(lastText, KNOWN), file.name, lastText);
    } catch (e) {
      st.textContent = e.message || String(e);
      st.className = "status err";
      showRaw(lastText);
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
    $("#sampleBtn2").addEventListener("click", () => { accept(P.parseText(SAMPLE, KNOWN), "예시 성적"); $("#out").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("#shareBtn").addEventListener("click", async () => {
      const data = { title: "세종대 공학인증 점검", text: "로그인 없이 성적표 하나로 공학인증 졸업요건 점검, 남은 학기 계획, 졸업심사 체크표까지", url: location.origin + location.pathname };
      try {
        if (navigator.share) { await navigator.share(data); return; }
        await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
        $("#shareBtn").textContent = "링크를 복사했습니다";
        setTimeout(() => ($("#shareBtn").textContent = "친구에게 공유"), 2000);
      } catch (e) { /* 공유 취소 */ }
    });
    $("#program").addEventListener("change", (e) => { S.program = e.target.value; S.autoProgram = false; S.planned = []; S.exclude = []; S.basis = null; syncSelects(); render(); });
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
      if (e.target.dataset.rename) {
        const c = S.courses.find((x) => x.id === e.target.dataset.rename);
        const v = e.target.value.trim();
        if (c && v) { c.name = v; c.ocr = false; render(); }
        return;
      }
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
    $("#ttBtn").addEventListener("click", makeTimetable);
    $("#seasonCap").addEventListener("change", () => render());
    $("#ttNext").addEventListener("click", () => { ttState.i = (ttState.i + 1) % ttState.list.length; renderTimetable(); });
    $("#summaryBtn").addEventListener("click", () => {
      document.body.classList.add("print-summary");
      const done = () => { document.body.classList.remove("print-summary"); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      window.print();
      setTimeout(done, 1500);
    });
    $("#csvBtn").addEventListener("click", () => {
      const r = rule(), res = E.evaluate(r, S.courses);
      const blob = new Blob([SH.csv(r, res, S.courses, sheetInfo())], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `공학인증_상담표_${prog().name}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("#plan").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.exclude) { S.exclude = (S.exclude || []).concat(b.dataset.exclude); render(); }
      if (b.dataset.unplan) { S.planned = (S.planned || []).filter((p) => p.name !== b.dataset.unplan); render(); }
    });
    $("#planTools").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unexclude]"); if (!b) return;
      S.exclude = (S.exclude || []).filter((n) => n !== b.dataset.unexclude); render();
    });
    $("#planTools").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#planName").value.trim(); if (!name) return;
      const r = rule();
      const cat = (r.catalog || []).find((c) => E.same(c.name, name));
      const [y, s2] = $("#planTerm").value.split("-").map(Number);
      S.planned = (S.planned || []).filter((p) => !E.same(p.name, name)).concat({ name: cat ? cat.name : name, credit: cat ? cat.credit : 3, year: y, sem: s2 });
      S.exclude = (S.exclude || []).filter((n) => !E.same(n, name));
      render();
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
    // 계획 시뮬레이터: 직접 넣은 과목(planned)과 뺀 과목(exclude)
    const calTerm = (y, s2) => `${Number(S.admit) + y - 1}-${s2}`;
    const planned = (S.planned || []).map((p, i) => ({ id: "plan" + i, name: p.name, credit: p.credit, grade: "", cat: "", term: calTerm(p.year, p.sem), planned: true, year: p.year, sem: p.sem }));
    const preload = {};
    planned.forEach((p) => (preload[`${p.year}-${p.sem}`] = (preload[`${p.year}-${p.sem}`] || 0) + p.credit));
    const resBase = planned.length ? E.evaluate(r, S.courses.concat(planned)) : res;
    const rec = E.recommend(r, resBase, { track, nextYear: ny, nextSem: ns, cap: S.cap, exclude: S.exclude || [], preload });
    rec.semesters.forEach((sm) => planned.filter((p) => p.year === sm.year && p.sem === sm.sem).forEach((p) => sm.courses.unshift(Object.assign({ mine: true, design: E.designCredit(r, p.name), reason: "직접 넣은 계획" }, p))));
    planned.filter((p) => !rec.semesters.some((sm) => sm.year === p.year && sm.sem === p.sem)).forEach((p) => {
      rec.semesters.push({ year: p.year, sem: p.sem, label: p.year <= 4 ? `${p.year}학년 ${p.sem}학기` : `추가 ${p.sem}학기`, courses: [Object.assign({ mine: true, design: E.designCredit(r, p.name), reason: "직접 넣은 계획" }, p)] });
    });
    rec.semesters.sort((a, b) => a.year - b.year || a.sem - b.sem);
    const recAsTaken = rec.semesters.flatMap((sm) => sm.courses.filter((c) => !c.mine).map((c, i) => ({ id: `rec-${sm.year}-${sm.sem}-${i}`, name: c.name, credit: c.credit, grade: "", cat: "", term: calTerm(sm.year, sm.sem) })));
    const after = E.evaluate(r, S.courses.concat(planned, recAsTaken));
    store.save();
    if (S.tab === "sheet") { renderSheet(r, res); return; }

    // 판정
    const shortAreas = res.areas.filter((a) => !a.ok);
    const openChecks = res.checks.filter((c) => !c.ok);
    const v = $("#verdict");
    v.className = "verdict " + (res.ok ? "ok" : "no");
    const plannedCr = rec.chosen.reduce((s, c) => s + c.credit, 0) + planned.reduce((s, c) => s + c.credit, 0);
    const nPlanned = rec.chosen.length + planned.length;
    v.innerHTML = res.ok
      ? `<span class="big">공학인증 요건을 모두 채웠습니다</span><p>${esc(prog().dept)} ${esc(basisLabel())}. 졸업 전 공학교육센터에서 최종 확인을 받으세요.</p>`
      : `<span class="big">${shortAreas.length ? shortAreas.map((a) => `${a.label} ${fmt(a.min - a.earned)}학점`).join(", ") + " 부족" : "학점은 채웠고 필수 과목이 남았습니다"}</span>
         <p>필수 조건 ${openChecks.length}개가 아직 남았습니다. ${after.ok ? `아래 계획대로 ${plannedCr}학점(${nPlanned}과목)을 더 들으면 요건을 채웁니다.` : `아래 계획으로는 아직 채우지 못하는 요건이 있습니다: ${after.areas.filter((a) => !a.ok).map((a) => `${a.label} ${fmt(a.min - a.earned)}학점`).concat(after.checks.filter((c) => !c.ok).slice(0, 2).map((c) => c.label)).join(", ")}.`}</p>`;

    // 눈금자
    const plannedBy = { GE: 0, MSC: 0, MAJOR: 0, DESIGN: 0 };
    after.areas.forEach((a) => { const now = res.areas.find((x) => x.id === a.id); plannedBy[a.id] = Math.max(0, a.earned - now.earned); });
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

    // 학과 졸업요건 + 인증 유지/포기 비교
    const g = renderGrad(res, rec, planned);
    if (g) {
      const open = g.rows.filter((x) => x.ok === false);
      const unk = g.rows.filter((x) => x.ok === null).length;
      $("#verdict").insertAdjacentHTML("beforeend", `<p class="both"><span class="pill ${res.ok ? "ok" : "no"}">공학인증 ${res.ok ? "충족" : "미충족"}</span><span class="pill ${g.ok ? "ok" : open.length ? "no" : "unk"}">학과 졸업 ${g.ok ? "충족" : open.length ? `미충족 ${open.length}개` : "확인 필요"}</span>${unk ? `<span class="hint">이수구분 정보가 없어 ${unk}개 항목은 판정하지 못했습니다.</span>` : ""}</p>`);
      if (res.ok && !g.ok && open.length) $("#verdict").className = "verdict no";
    }
    renderSeason(rule(), res, rec, g);
    $("#ttSub").textContent = OFFERED ? `${OFFERED.semester || "현재"} 수강편람 기준 · 강좌 ${OFFERED.count}개` : "";

    // 계획
    $("#planSub").textContent = `${track ? track.label : ""} 진로 기준 · 학기당 인증과목 최대 ${S.cap}학점` + (OFFERED ? ` · 개설 여부는 ${OFFERED.semester || "현재"} 수강편람(${OFFERED.updated}) 기준` : "");
    const d = r.design || {};
    $("#plan").innerHTML = rec.semesters.length ? rec.semesters.filter((s) => s.courses.length).map((s) => {
      const sum = s.courses.reduce((a, c) => a + c.credit, 0);
      return `<li><div class="when">${esc(s.label)}<small>${sum}학점</small></div><ul>${s.courses.map((c) => {
        const tags = [];
        if (c.kind === "required") tags.push('<span class="tag req">필수</span>');
        if (c.design) tags.push(`<span class="tag dsg">설계 ${fmt(c.design)}</span>`);
        if (c.fit > 0) tags.push('<span class="tag fit">진로</span>');
        if (c.mine) tags.push('<span class="tag mine">내 계획</span>');
        const off = offeredInfo(c.name);
        if (off) tags.push(off.length
          ? `<span class="tag open" title="${esc(off.slice(0, 6).map((x) => `${x.cl}분반 ${x.t || "시간 미정"} ${x.p}`).join("\n"))}">이번 학기 ${off.length}분반</span>`
          : '<span class="tag closed" title="현재 수강편람에 없는 과목입니다">이번 학기 미개설</span>');
        const when = c.mine ? "" : c.year && c.sem ? `권장 ${c.year}-${c.sem}` : c.sem ? `${c.sem}학기 개설` : "";
        const btn = c.mine
          ? `<button type="button" class="mini" data-unplan="${esc(c.name)}" aria-label="${esc(c.name)} 계획에서 삭제">삭제</button>`
          : `<button type="button" class="mini" data-exclude="${esc(c.name)}" aria-label="${esc(c.name)} 빼고 다시 짜기" title="이 과목 없이 다시 짜기">빼기</button>`;
        return `<li class="c"><span><span class="nm">${esc(c.name)}</span>${tags.join("")}<span class="why">${esc([c.reason, when].filter(Boolean).join(" · "))}</span></span><span class="cr">${fmt(c.credit)}학점 ${btn}</span></li>`;
      }).join("")}</ul></li>`;
    }).join("") : `<li><div class="when">추가 수강 없음</div><ul><li class="c"><span>인증 요건만 보면 더 들을 과목이 없습니다.</span></li></ul></li>`;
    if (rec.gaps.length) $("#plan").innerHTML += `<li><div class="when">더 필요한 학점</div><ul><li class="c"><span>교과과정표에서 고를 과목이 부족합니다. ${rec.gaps.map((g) => `${esc(g.label)} ${fmt(g.left)}학점`).join(", ")}을 인정 과목으로 더 들어야 합니다. 학과 사무실에서 인정 과목 목록을 확인하세요.</span></li></ul></li>`;
    if (rec.unplaced.length) $("#plan").innerHTML += `<li><div class="when">배치 못 함</div><ul>${rec.unplaced.map((c) => `<li class="c"><span class="nm">${esc(c.name)}</span><span class="cr">${fmt(c.credit)}학점</span></li>`).join("")}</ul></li>`;
    const ex = S.exclude || [];
    $("#planTools").innerHTML = `
      <form id="planForm" class="plan-add">
        <input id="planName" list="planNames" placeholder="듣고 싶은 과목 넣기 (예: 컴퓨터그래픽스)" aria-label="계획에 넣을 과목">
        <datalist id="planNames">${[...new Set((r.catalog || []).map((c) => c.name))].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <select id="planTerm" aria-label="넣을 학기">${termOptions()}</select>
        <button class="btn ghost" type="submit">계획에 넣기</button>
      </form>
      ${ex.length ? `<p class="hint">뺀 과목: ${ex.map((n) => `<button type="button" class="chip-x" data-unexclude="${esc(n)}" title="다시 추천에 포함">${esc(n)} ✕</button>`).join(" ")}</p>` : ""}
      <p class="after ${after.ok ? "ok" : "no"}">${after.ok ? "이 계획대로 들으면 공학인증 요건을 모두 채웁니다." : `이 계획으로는 채우지 못하는 요건: ${esc(after.areas.filter((a) => !a.ok).map((a) => `${a.label} ${fmt(a.min - a.earned)}학점`).concat(after.checks.filter((c) => !c.ok).map((c) => c.label)).slice(0, 4).join(", "))}. 뺀 과목을 되돌리거나 다른 과목을 넣어 보세요.`}</p>`;
    $("#picks").innerHTML = rec.picks.length ? `<div class="picks"><h3>요건과 별개로 이 진로에 도움이 되는 과목</h3><p>${rec.picks.map((p) => esc(p.name) + (p.year ? ` (${p.year}-${p.sem || "?"})` : "")).join(", ")}</p></div>` : "";

    // 과목 표
    const evalMap = new Map(res.courses.map((c) => [c.id, c]));
    const rows = [...S.courses].sort((a, b) => (E.termOrder(a.term) || 0) - (E.termOrder(b.term) || 0));
    $("#courseRows").innerHTML = rows.map((c) => {
      const ev = evalMap.get(c.id);
      const failed = !ev && c.grade && /^(F|NP|U|W)$/i.test(c.grade);
      const area = ev ? ev.area : null;
      const how = ev ? (ev.renamed ? `‘${ev.name}’(으)로 인정 · 이름 바뀐 과목` : ev.ocrFixed ? `‘${ev.name}’(으)로 맞춤 · 글자 인식 보정` : ev.how) : failed ? "미이수 등급" : "재수강 이전 기록";
      const opts = ["auto", "GE", "MSC", "MAJOR", "OTHER"].map((k) => `<option value="${k}" ${(c.area || "auto") === k ? "selected" : ""}>${k === "auto" ? `자동: ${area ? AREA_LABEL[area] : "-"}` : AREA_LABEL[k]}</option>`).join("");
      const dc = ev && ev.area === "MAJOR" ? E.designCredit(r, c.name) : 0;
      return `<tr class="${failed ? "fail" : ""} ${ev && ev.guess ? "guess" : ""}">
        <td>${esc(c.term || "")}</td>
        <td><input class="nm-edit" data-rename="${c.id}" value="${esc(c.name)}" aria-label="과목명 고치기">${dc ? ` <span class="tag dsg">설계 ${fmt(dc)}</span>` : ""}<span class="how">${esc(how)}</span></td>
        <td class="num">${fmt(c.credit)}</td><td>${esc(c.grade || "")}</td>
        <td><select data-id="${c.id}" aria-label="${esc(c.name)} 인증 영역">${opts}</select> <button class="del" data-del="${c.id}" aria-label="${esc(c.name)} 삭제" title="삭제">✕</button></td></tr>`;
    }).join("");

    // 근거
    const notDesign = res.designRows.filter((x) => !x.counted);
    const guesses = res.courses.filter((c) => c.guess).length;
    const n = r.notes || {};
    $("#notes").innerHTML = `
      ${res.renamed.length ? `<p class="warn">${esc(S.admit)}학번 기준에는 이름이 다르게 올라 있어 같은 과목으로 인정한 과목: ${res.renamed.map((x) => `${esc(x.from)} → ${esc(x.to)}`).join(", ")}. 학번별 대체과목 인정은 학과마다 다를 수 있으니 확인해 주세요.</p>` : ""}
      ${guesses ? `<p class="warn">교과과정표에 없는 과목 ${guesses}개는 성적표 이수구분(전필·전선)만 보고 전공으로 셌습니다. 노란 테두리 과목을 확인해 주세요.</p>` : ""}
      ${notDesign.length ? `<p class="warn">설계학점으로 인정하지 않은 과목: ${notDesign.map((x) => `${esc(x.name)}(${esc(x.why)})`).join(", ")}</p>` : ""}
      ${r.catalogFrom ? `<p>${esc(S.admit)}학번 이수체계표가 게시되지 않아, 과목 분류와 추천에는 ${esc(r.catalogFrom)}학번 표를 사용했습니다.</p>` : ""}
      <p>${esc(prog().name)} 프로그램, ${esc(basisLabel())}. 원문: <a href="${esc(r.src)}" target="_blank" rel="noopener">공학교육센터 페이지</a></p>
      <details><summary>요건 원문 보기</summary>
        ${["GE", "MSC", "MAJOR", "TOTAL", "notice"].filter((k) => n[k]).map((k) => `<p class="raw"><b>${{ GE: "전문교양", MSC: "MSC/BSM", MAJOR: "전공·설계", TOTAL: "인증 최소학점", notice: "공지" }[k]}</b>\n${esc(n[k])}</p>`).join("")}
      </details>`;
  }

  const fmt = (x) => (Math.round(x * 10) / 10).toString();

  function offeredInfo(name) {
    if (!OFFERED || !OFFERED.courses) return null;
    const k = E.nkey(name);
    for (const n of Object.keys(OFFERED.courses)) if (E.nkey(n) === k || E.same(n, name)) return OFFERED.courses[n];
    return [];
  }

  function termOptions() {
    const out = [];
    const [ny, ns] = (S.next || "1-1").split("-").map(Number);
    let y = ny, s2 = ns;
    for (let i = 0; i < 8 && y <= 5; i++) {
      out.push(`<option value="${y}-${s2}">${y <= 4 ? `${y}학년 ${s2}학기` : `추가 ${s2}학기`}</option>`);
      if (s2 === 1) s2 = 2; else { s2 = 1; y++; }
    }
    return out.join("");
  }

  const CERT_LABEL = { 영어졸업인증: "영어", 고전독서졸업인증: "고전독서", 고전독서인증: "고전독서", 소프트웨어코딩졸업인증: "SW코딩" };
  function renderGrad(res, rec, planned) {
    const box = $("#gradBlock");
    const dr = GRADD && GR ? GR.deptRule(GRADD, S.program, Number(S.admit)) : null;
    if (!dr) { box.hidden = true; return; }
    box.hidden = false;
    S.certs = S.certs || {};
    const g = GR.evaluateGrad(dr, S.courses, S.certs);
    $("#gradSub").textContent = `${dr.dept} ${dr.year}학번 교과과정 기준${dr.year !== String(S.admit) ? ` (${S.admit}학번 표가 없어 가장 가까운 연도)` : ""}${dr.from ? ` · ${dr.from}년 표 준용` : ""}`;
    $("#gradRows").innerHTML = g.rows.map((x) => {
      const mark = x.ok === null ? '<span class="mark unk" aria-label="판정 불가">?</span>' : `<span class="mark ${x.ok ? "ok" : "no"}" aria-label="${x.ok ? "충족" : "미충족"}">${x.ok ? "✓" : ""}</span>`;
      const unit = x.unit || "학점";
      return `<li>${mark}<span>${esc(x.label)}<span class="det">${esc(x.note || "")}</span></span><span class="grp">${x.unknown ? "-" : `${fmt(x.earned)} / ${fmt(x.min)}${unit}`}</span></li>`;
    }).join("");
    if (dr.cert) {
      $("#certs").hidden = false;
      $("#certs").innerHTML = `<legend>통과한 졸업인증 (${dr.cert.items.length}개 중 ${dr.cert.pick}개 필요)</legend>` +
        dr.cert.items.map((it) => `<label class="cert"><input type="checkbox" data-cert="${esc(it)}" ${S.certs[it] ? "checked" : ""}> ${esc(CERT_LABEL[it] || it)}</label>`).join("") +
        (dr.cert.note ? `<p class="hint">${esc(dr.cert.note)}</p>` : "");
      $("#certs").onchange = (e) => { if (e.target.dataset.cert) { S.certs[e.target.dataset.cert] = e.target.checked; render(); } };
    } else $("#certs").hidden = true;

    // 공학인증 유지 vs 포기
    const planCr = rec.chosen.reduce((s2, c) => s2 + c.credit, 0) + planned.reduce((s2, c) => s2 + c.credit, 0);
    const cmp = GR.compare(g, res, planCr, 18);
    const cell = (x) => `<b>${x.credits}학점</b><span>약 ${x.semesters}학기 (학기당 18학점)</span><span>남은 조건 ${x.open}개</span>`;
    $("#compare").innerHTML = `
      <h3>공학인증 유지 vs 포기</h3>
      <div class="cmp">
        <div><h4>유지</h4>${cell(cmp.keep)}</div>
        <div><h4>포기 (학과 졸업요건만)</h4>${cell(cmp.quit)}</div>
      </div>
      <p class="hint">2016학번부터는 공학인증을 이수해야 졸업할 수 있고, 포기는 ${esc(GR.QUIT_REASONS.slice(0, 7).join("·"))} 등 사유가 있을 때만 3학년 2학기에 포기서로 가능합니다. 사유가 없어지면 다시 인증을 이수해야 합니다. 남은 학점은 이수구분 기준 추정치입니다.</p>`;
    return g;
  }

  // ---------- 계절학기 추천 ----------
  function renderSeason(r, res, rec, g) {
    const box = $("#seasonBlock");
    if (!SEASON || !SEASON.courses) { box.hidden = true; return; }
    box.hidden = false;
    const track = C.tracks.find((t) => t.id === S.track);
    const taken = (n) => res.courses.some((c) => E.same(c.name, n));
    const missing = new Set(res.checks.filter((c) => !c.ok).flatMap((c) => c.missing || []).map(E.nkey));
    const inRec = (n) => rec.chosen.find((c) => E.same(c.name, n));
    const gap = (id) => { const x = g && g.rows.find((y) => y.id === id); return x && x.ok === false; };
    const commonMissing = new Set(((g && g.missingCommon) || []).map((x) => E.nkey(x.name)));
    const depts = ((GR && GR.DEPT[S.program]) || []).map((dn) => dn.replace(/(학과|전공|학부)$/, ""));
    const own = (secs) => secs.some((x) => depts.some((dn) => (x.d || "").replace(/\s/g, "").includes(dn)));
    const cands = [];
    Object.entries(SEASON.courses).forEach(([n, secs]) => {
      if (taken(n)) return;
      const k = secs[0].k || "", why = [];
      let w = 0;
      const rc = inRec(n);
      if (missing.has(E.nkey(n))) { w += 110; why.push("공학인증 필수"); }
      else if (rc) { w += rc.kind === "required" ? 100 : rc.design ? 80 : 60; why.push(rc.design ? `공학인증 설계 ${fmt(rc.design)}학점` : "공학인증 계획 과목"); }
      if (commonMissing.has(E.nkey(n))) { w += 90; why.push("교양 공통필수"); }
      if (/^균필/.test(k) && gap("balance")) { w += 50; why.push("균형교양 부족분"); }
      if (/^기필/.test(k) && gap("basic")) { w += 50; why.push("학문기초교양 부족분"); }
      if (/^전[필선기]/.test(k) && own(secs) && (gap("mReq") || gap("mElec") || gap("mBasic"))) { w += 40; why.push("학과 전공학점 부족분"); }
      const f = E.careerScore(track, n);
      if (f > 0 && (own(secs) || (r.catalog || []).some((c) => E.same(c.name, n)) || !/^전/.test(k))) { w += 20 + f * 3; why.push("희망 진로"); }
      else if (f > 0) { w += 8 + f * 2; why.push("희망 진로 · 타 학과 과목(학점 인정 확인)"); }
      if (w > 0) cands.push({ n, secs, w, why, cr: secs[0].cr || 3, f });
    });
    cands.sort((a, b) => b.w - a.w || b.f - a.f);
    // 들을 학점 안에서 시간이 겹치지 않게 고르기
    const cap = +$("#seasonCap").value, pick = [];
    let total = 0;
    for (const c of cands) {
      if (total + c.cr > cap) continue;
      const sec = c.secs.map((x) => ({ x, slots: TT.parseTime(x.t) })).find((x) => !pick.some((p2) => TT.clash(p2.slots, x.slots)));
      if (!sec) continue;
      pick.push(Object.assign({}, c, { sec: sec.x, slots: sec.slots }));
      total += c.cr;
    }
    const others = cands.filter((c) => !pick.includes(c) && !pick.some((p2) => p2.n === c.n)).slice(0, 6);
    $("#seasonSub").textContent = `${SEASON.label} 개설 ${SEASON.count}분반 · ${SEASON.updated} 기준`;
    $("#seasonNote").textContent = SEASON.current
      ? "공학인증·졸업에 모자란 과목을 먼저, 남는 학점은 희망 진로 과목으로 골랐습니다."
      : `아직 다가오는 계절학기 개설 강좌가 공개되지 않아 지난 ${SEASON.label} 개설 과목으로 보여 드립니다. 새 계절학기 강좌가 개설되면 자동으로 바뀝니다.`;
    $("#seasonList").innerHTML = pick.length ? `<li><div class="when">추천<small>${fmt(total)}학점</small></div><ul>${pick.map((c) =>
      `<li class="c"><span><span class="nm">${esc(c.n)}</span>${c.why.map((w2) => `<span class="tag ${/필수/.test(w2) ? "req" : /진로/.test(w2) ? "fit" : "dsg"}">${esc(w2)}</span>`).join("")}<span class="why">${esc(c.sec.cl)}분반 · ${esc(c.sec.p || "교수 미정")} · ${esc(c.sec.t || "시간 미정")} · ${esc(c.sec.d || "")}</span></span><span class="cr">${fmt(c.cr)}학점</span></li>`).join("")}</ul></li>`
      + (others.length ? `<li><div class="when">다른 후보</div><ul><li class="c"><span class="why">${others.map((c) => `${esc(c.n)}(${esc(c.why.join("·"))})`).join(", ")}</span></li></ul></li>` : "")
      : `<li><div class="when">추천 없음</div><ul><li class="c"><span>이번 계절학기 개설 과목 중에는 공학인증·졸업이나 희망 진로에 맞는 과목이 없습니다.</span></li></ul></li>`;
  }

  // ---------- 추천 시간표 ----------
  const TT = window.TIMETABLE;
  let ttState = { list: [], i: 0 };
  function ttCandidates(r, res, rec, g) {
    const d = r.design || {};
    const taken = (n) => res.courses.some((c) => E.same(c.name, n)) || (S.exclude || []).some((x) => E.same(x, n));
    const out = [];
    const add = (name, credit, weight, reason, kind) => {
      if (!name || taken(name) || out.some((c) => E.same(c.name, name))) return;
      out.push({ name, credit: credit || 3, weight, reason, kind });
    };
    const first = rec.semesters[0];
    (first ? first.courses : []).forEach((c) => add(c.name, c.credit, c.kind === "required" || c.mine ? 110 : 100, c.mine ? "내 계획" : `계획 ${first.label}`, c.kind || "plan"));
    rec.chosen.forEach((c) => { if (!E.inList(c.name, d.capstone)) add(c.name, c.credit, c.kind === "required" ? 60 : c.design ? 50 : 35, "공학인증 계획", c.kind); });
    (g && g.missingCommon ? g.missingCommon : []).forEach((x) => add(x.name, x.credit, 40, "교양 공통필수", "grad"));
    const track = C.tracks.find((t) => t.id === S.track);
    rec.picks.forEach((p2) => add(p2.name, p2.credit, 20 + p2.fit * 3, "진로", "fit"));
    (r.catalog || []).filter((c) => c.area === "MAJOR").map((c) => ({ c, f: E.careerScore(track, c.name) })).filter((x) => x.f > 0)
      .sort((a, b) => b.f - a.f).slice(0, 15).forEach((x) => add(x.c.name, x.c.credit, 10 + x.f * 2, "진로", "fit"));
    if (OFFERED) {
      // 이번 수강편람에 있는 우리 학과 전공 과목 중 진로에 맞는 것
      const depts = (GR && GR.DEPT[S.program]) || [];
      const deptOf = (secs) => secs.some((x) => depts.some((dn) => (x.d || "").replace(/\s/g, "").includes(dn.replace(/(학과|전공|학부)$/, ""))));
      Object.entries(OFFERED.courses).map(([n, secs]) => ({ n, secs, f: E.careerScore(track, n) }))
        .filter((x) => x.f > 0 && x.secs.some((y) => /^전[필선기]/.test(y.k)) && deptOf(x.secs))
        .sort((a, b) => b.f - a.f).slice(0, 25)
        .forEach((x) => add(x.n, x.secs[0].cr || 3, 8 + x.f * 2, "진로 · 이번 학기 개설 전공", "fit"));
      // 균형교양이 모자라면 개설된 균형교양
      const bal = g && g.rows.find((r2) => r2.id === "balance");
      if (bal && bal.ok === false) Object.entries(OFFERED.courses).filter(([, secs]) => secs.some((y) => y.k === "균필")).slice(0, 12)
        .forEach(([n, secs]) => add(n, secs[0].cr || 3, 30, "균형교양 부족분", "grad"));
    }
    return out;
  }

  function renderTimetable() {
    const out = $("#ttOut");
    const t = ttState.list[ttState.i];
    $("#ttNext").hidden = ttState.list.length < 2;
    if (!t) { out.innerHTML = `<p class="warn">조건에 맞는 시간표를 찾지 못했습니다. 쉬는 요일이나 시간 조건을 줄이거나, 목표 학점을 낮춰 보세요.</p>`; return; }
    const timed = t.courses.filter((c) => c.slots.length), untimed = t.courses.filter((c) => !c.slots.length);
    const start = 9 * 60, end = Math.max(18 * 60, ...timed.flatMap((c) => c.slots.map((x) => Math.ceil(x.e / 30) * 30)));
    const rows = (end - start) / 30;
    let cells = `<div class="tt-h"></div>` + TT.DAYS.slice(0, 5).map((dname) => `<div class="tt-h">${dname}</div>`).join("");
    for (let i = 0; i < rows; i++) cells += `<div class="tt-t" style="grid-row:${i + 2}">${i % 2 === 0 ? `${(start + i * 30) / 60}` : ""}</div>`;
    timed.forEach((c, k) => c.slots.filter((x) => x.d < 5).forEach((x) => {
      const r0 = Math.floor((x.s - start) / 30) + 2, r1 = Math.ceil((x.e - start) / 30) + 2;
      cells += `<div class="tt-b k${k % 6} ${c.kind === "required" ? "req" : ""}" style="grid-column:${x.d + 2};grid-row:${r0}/${r1}" title="${esc(c.name)} ${esc(c.sec.cl)}분반 ${esc(c.sec.p)}"><b>${esc(c.name)}</b><span>${esc(c.sec.p || "")}</span></div>`;
    }));
    out.innerHTML = `
      <p class="tt-sum"><b>${t.credits}학점 · ${t.courses.length}과목</b> (${ttState.i + 1}/${ttState.list.length}안)</p>
      <div class="tt-grid" style="grid-template-rows: 26px repeat(${rows}, 20px)">${cells}</div>
      <ul class="tt-list">${t.courses.map((c) => `<li><span><b>${esc(c.name)}</b> ${esc(c.sec.cl)}분반 · ${esc(c.sec.p || "교수 미정")} · ${esc(c.sec.t || "시간 미정")}</span><span class="why">${esc(c.reason)} · ${fmt(c.credit)}학점</span></li>`).join("")}</ul>
      ${untimed.length ? `<p class="hint">시간이 정해지지 않은 과목(온라인·집중 이수 등): ${untimed.map((c) => esc(c.name)).join(", ")}</p>` : ""}
      <p class="hint">${esc(OFFERED.semester || "현재")} 수강편람(${esc(OFFERED.updated)}, 올클 공개 데이터) 기준입니다. 수강신청 때 분반·여석·수강 대상 학년을 꼭 다시 확인하세요.</p>`;
  }

  function makeTimetable() {
    if (!OFFERED || !TT) { $("#ttOut").innerHTML = `<p class="warn">개설 강좌 정보를 불러오지 못했습니다.</p>`; return; }
    const r = rule(), res = E.evaluate(r, S.courses);
    const track = C.tracks.find((t) => t.id === S.track);
    const [ny, ns] = S.next.split("-").map(Number);
    const rec = E.recommend(r, res, { track, nextYear: ny, nextSem: ns, cap: S.cap, exclude: S.exclude || [] });
    const dr = GRADD && GR ? GR.deptRule(GRADD, S.program, Number(S.admit)) : null;
    const g = dr ? GR.evaluateGrad(dr, S.courses, S.certs || {}) : null;
    const cands = ttCandidates(r, res, rec, g);
    const offDays = [...document.querySelectorAll(".offdays input:checked")].map((x) => +x.value);
    const prefs = { cap: +$("#ttCap").value, offDays, noBefore: $("#ttNo9").checked ? 10 * 60 : 0, noAfter: $("#ttNoNight").checked ? 18 * 60 : 0 };
    // 같은 과목이 여러 학과에 열리면 우리 학과 분반만 쓴다
    const depts = ((GR && GR.DEPT[S.program]) || []).map((dn) => dn.replace(/(학과|전공|학부)$/, ""));
    const mine = (x) => depts.some((dn) => (x.d || "").replace(/\s/g, "").includes(dn));
    const sectionsOf = (n) => { const all = offeredInfo(n) || []; const own = all.filter(mine); return own.length ? own : all; };
    ttState = { list: TT.build(cands, sectionsOf, prefs, 5), i: 0 };
    renderTimetable();
  }

  function sheetInfo() {
    const now = new Date();
    return {
      programName: prog().name, basis: S.admit, currentTerm: S.curTerm || "",
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
세종인을위한진로설계	공필	1	P
문제해결을위한글쓰기와발표	공필	3	A+
미적분학1	기필	3	B+
확률및통계	전기	3	A0
C프로그래밍및실습	전기	3	A+
2024학년도 2학기
세종인을위한전공탐색	공필	1	P
대학영어	공필	2	A0
서양철학:쟁점과토론	공필	3	B0
우주자연인간	공필	1	A0
공업수학1	전기	3	B+
선형대수	전기	3	A0
고급C프로그래밍및실습	전기	3	A0
2025학년도 1학기
자료구조및실습	전필	3	A+
디지털시스템	전필	3	B+
공학설계기초(산학프로젝트입문)	전필	3	A0
웹프로그래밍	전선	3	A0
일반물리학1	기필	3	C+
심리학의이해	균필	3	A0
2025학년도 2학기
알고리즘및실습	전필	3	B+
이산수학및프로그래밍	전기	3	A0
데이터베이스	전선	3	A+
세계사	교선	3	A0
인공지능과빅데이터	기필	3	B+
2026학년도 1학기
운영체제	전필	3	B0
기계학습	전선	3	A+
컴퓨터네트워크	전필	3	F
경영학	교선	3	A0
현대사회와윤리	균필	3	B+`;

  boot();
})();
