/* 올린 파일 검사: 허용한 형식만, 확장자와 실제 내용(파일 시그니처)이 맞을 때만 읽는다 */
(function (root) {
  "use strict";
  const MB = 1024 * 1024;
  // 확장자 → 종류, 최대 크기, 시그니처 검사
  const TYPES = {
    pdf: { kind: "pdf", max: 30 * MB, sig: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) || findIn(b, "%PDF-", 1024) },
    xlsx: { kind: "xlsx", max: 15 * MB, sig: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
    xls: { kind: "xlsx", max: 15 * MB, sig: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
    png: { kind: "image", max: 20 * MB, sig: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    jpg: { kind: "image", max: 20 * MB, sig: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
    jpeg: { kind: "image", max: 20 * MB, sig: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
    webp: { kind: "image", max: 20 * MB, sig: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 4) === "WEBP" },
    txt: { kind: "text", max: 2 * MB, sig: isPlainText },
    csv: { kind: "text", max: 2 * MB, sig: isPlainText },
    tsv: { kind: "text", max: 2 * MB, sig: isPlainText },
  };
  const ACCEPT = Object.keys(TYPES).map((x) => "." + x).join(",");
  // 실행 파일·스크립트로 보이는 시그니처는 확장자와 상관없이 거부
  const DANGER = [
    { name: "Windows 실행 파일", test: (b) => startsWith(b, [0x4d, 0x5a]) },
    { name: "리눅스 실행 파일", test: (b) => startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) },
    { name: "맥 실행 파일", test: (b) => [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => startsWith(b, s)) },
    { name: "스크립트", test: (b) => startsWith(b, [0x23, 0x21]) },
  ];
  const MARKUP = /<\s*(script|html|iframe|object|embed|svg|\?php)\b|javascript:/i;

  function startsWith(b, sig) { return sig.every((v, i) => b[i] === v); }
  function ascii(b, from, n) { return String.fromCharCode(...b.slice(from, from + n)); }
  function findIn(b, s, within) { return ascii(b, 0, Math.min(within, b.length)).includes(s); }
  function isPlainText(b) {
    // NUL 바이트나 제어문자가 많으면 텍스트가 아님
    let ctrl = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === 0) return false;
      if (c < 9 || (c > 13 && c < 32)) ctrl++;
    }
    return ctrl <= b.length * 0.01;
  }

  function fail(msg) { const e = new Error(msg); e.fileRejected = true; return e; }

  /**
   * file: File(Blob, name, size). 반환: { kind: pdf|xlsx|image|text, ext }. 허용하지 않으면 예외.
   * 처음 4KB만 읽어서 판단한다.
   */
  async function inspect(file) {
    const name = String(file.name || "");
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name.replace(/^.*[\\/]/, ""))) throw fail("파일 이름에 쓸 수 없는 문자가 있습니다.");
    const parts = name.toLowerCase().split(".");
    const ext = parts.length > 1 ? parts.pop() : "";
    const t = TYPES[ext];
    if (!t) throw fail(`${ext ? "." + ext + " 파일" : "확장자가 없는 파일"}은 읽지 않습니다. PDF, 엑셀(XLSX·XLS), 이미지(PNG·JPG·WEBP), 텍스트(TXT·CSV)만 넣어 주세요.`);
    // 'report.exe.pdf' 같은 이중 확장자는 거부
    if (parts.slice(1).some((p) => /^(exe|scr|bat|cmd|com|msi|js|jse|vbs|vbe|ps1|sh|jar|apk|dll|hta|html?|svg|php)$/.test(p))) throw fail("확장자가 두 개 붙은 파일은 읽지 않습니다. 파일 이름을 확인해 주세요.");
    if (!file.size) throw fail("빈 파일입니다.");
    if (file.size > t.max) throw fail(`파일이 너무 큽니다(${(file.size / MB).toFixed(1)}MB). ${ext.toUpperCase()}는 ${t.max / MB}MB까지 넣을 수 있습니다.`);
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const bad = DANGER.find((d) => d.test(head));
    if (bad) throw fail(`${bad.name}로 보이는 파일이라 읽지 않습니다.`);
    if (!t.sig(head)) throw fail(`.${ext} 확장자지만 실제 내용이 ${ext.toUpperCase()} 형식이 아닙니다. 확장자를 바꾼 파일은 읽지 않습니다.`);
    if (t.kind === "text" && MARKUP.test(new TextDecoder("utf-8", { fatal: false }).decode(head))) throw fail("웹페이지·스크립트 코드가 들어 있는 텍스트 파일은 읽지 않습니다.");
    return { kind: t.kind, ext };
  }

  const api = { inspect, ACCEPT, TYPES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FILECHECK = api;
})(typeof self !== "undefined" ? self : this);
