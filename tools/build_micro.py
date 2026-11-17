#!/usr/bin/env python3
"""수강편람 PDF의 '마이크로디그리 이수 안내'와 'AI 마이크로디그리 이수 안내'를 읽어 data/micro.json 을 만든다.

사용: python3 tools/build_micro.py 수강편람.pdf --semester 2026-2 --article 891086
필요: pip install pdfplumber
"""
import argparse, datetime, json, os, re, sys

import pdfplumber

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "micro.json")
GEN_HEAD = re.compile(r"^(\d{1,2})\.\s*\[([^\]]+)\]\s*(.+?)\s*$")
AI_HEAD = re.compile(r"^(\d{1,2})\.\s*(.+?마이크로디그리)\s*$")


def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def credit_of(s):
    m = re.match(r"\s*(\d+)", str(s or ""))
    return int(m.group(1)) if m else None


def parse_course(name):
    """'컴퓨터사고기반기초코딩\n(동일과목 : 컴퓨팅사고기반기초코딩)' → 이름, 동일과목 목록"""
    raw = clean(name)
    alias = []
    for m in re.finditer(r"\(\s*동일과목\s*[:：]\s*([^)]+)\)", raw):
        alias += [clean(x) for x in re.split(r"[,/]", m.group(1)) if clean(x)]
    nm = clean(re.sub(r"\(\s*동일과목\s*[:：][^)]*\)", "", raw))
    nm = re.sub(r"\s*\(\s*(세종대|동국대|대전대|[가-힣]+대)\s*제작\s*\)", "", nm)  # 제작 대학 표기 제거
    for m in re.finditer(r"\(\s*구\s*[:：]\s*([^)]+)\)", nm):  # (구:옛 과목명)
        alias.append(clean(m.group(1)))
    nm = clean(re.sub(r"\(\s*구\s*[:：][^)]*\)", "", nm)).lstrip("*").strip()
    return nm, alias


def find_sections(pdf):
    """본문(목차 제외)에서 9장 시작 쪽, 10장(AI) 시작 쪽, 11장 시작 쪽"""
    s9 = s10 = s11 = None
    for i, pg in enumerate(pdf.pages):
        t = pg.extract_text() or ""
        if "· ·" in t or ". . ." in t:  # 목차
            continue
        if s9 is None and re.search(r"^\s*\d+\.\s*마이크로디그리 이수 안내\s*$", t, re.M):
            s9 = i
        if s10 is None and re.search(r"^\s*\d+\.\s*AI 마이크로디그리 이수 안내\s*$", t, re.M):
            s10 = i
        if s10 is not None and s11 is None and i > s10 and re.search(r"^\s*\d+\.\s*전공, 복수", t, re.M):
            s11 = i
    return s9, s10, s11


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--semester", required=True)
    ap.add_argument("--article", help="학사공지 글 번호")
    a = ap.parse_args()
    pdf = pdfplumber.open(a.pdf)
    s9, s10, s11 = find_sections(pdf)
    if s9 is None or s10 is None:
        sys.exit("마이크로디그리 장을 찾지 못함")
    s11 = s11 or len(pdf.pages)
    programs, rules = [], {"general": [], "ai": []}
    cur = None
    for pi in range(s9, s11):
        kind = "ai" if pi >= s10 else "general"
        pg = pdf.pages[pi]
        tables = pg.find_tables()
        items = []
        for ln in pg.extract_text_lines():
            if any(t.bbox[1] - 1 <= ln["top"] <= t.bbox[3] + 1 for t in tables):
                continue
            items.append((ln["top"], "line", ln["text"]))
        for t in tables:
            items.append((t.bbox[1], "table", t.extract()))
        items.sort(key=lambda x: x[0])
        for _, typ, v in items:
            if typ == "line":
                text = clean(v)
                m = (GEN_HEAD if kind == "general" else AI_HEAD).match(text)
                if m and not text.endswith("안내"):
                    if kind == "general":
                        n, typ_, name = m.group(1), m.group(2), m.group(3)
                    else:
                        n, typ_, name = m.group(1), None, m.group(2)
                    name = re.sub(r"\s*과정$", "", name) if kind == "general" and name.endswith(" 과정") else name
                    cur = {"id": f"{'ai' if kind == 'ai' else 'md'}{int(n):02d}", "kind": kind, "type": typ_, "name": name,
                           "credits": None, "dept": "", "contact": "", "courses": [], "notes": [], "page": pi + 1}
                    programs.append(cur)
                    continue
                if cur is None or cur["kind"] != kind:
                    # 장 머리말(이수조건·신청방법 등)
                    if re.match(r"^[가-라]\.\s*(이수조건|이수학점|신청방법|유의사항)", text) or re.match(r"^\d\)\s", text):
                        rules[kind].append(text)
                    continue
                m = re.search(r"이수학점\s*[:：]\s*(\d+)\s*학점", text)
                if m and cur["credits"] is None:
                    cur["credits"] = int(m.group(1))
                    extra = clean(text[m.end():])
                    if extra:
                        cur["notes"].append("이수학점 " + text.split(":", 1)[1].strip())
                m = re.search(r"주관학과\s*[:：]\s*(.+)$", text)
                if m:
                    cur["dept"] = m.group(1).strip()
                m = re.search(r"관련\s*문의\s*[:：]\s*(.+)$", text)
                if m:
                    ct = re.sub(r"(\w+)@se\1@", r"\1@", m.group(1).strip())  # 원문 오타 'cedpt@secedpt@...'
                    cur["contact"] = ct + ")" if ct.count("(") > ct.count(")") else ct
                if text.startswith("※") and len(cur["notes"]) < 6:
                    cur["notes"].append(text.lstrip("※ ").strip())
                elif cur["notes"] and cur["notes"][-1] and not re.match(r"^([가-바]\.|\d\))", text) and cur.get("_noteopen"):
                    cur["notes"][-1] += " " + text
                cur["_noteopen"] = text.startswith("※") or (cur.get("_noteopen") and not re.match(r"^([가-바]\.|\d\))", text))
                continue
            # 표
            if cur is None or cur["kind"] != kind or not v:
                continue
            head = [clean(c) for c in v[0]]
            if "교과목명" not in "".join(head):
                if not cur.get("_cols"):
                    continue
                cols, rows = cur["_cols"], v  # 쪽이 넘어가며 이어진 표
            else:
                cols = {
                    "name": next(i for i, h in enumerate(head) if "교과목명" in h),
                    "credit": next((i for i, h in enumerate(head) if h.startswith("학점")), None),
                    "cat": next((i for i, h in enumerate(head) if h in ("구분", "영역", "분류")), None),
                    "code": next((i for i, h in enumerate(head) if "학수번호" in h), None),
                    "univ": next((i for i, h in enumerate(head) if h == "대학"), None),
                }
                cur["_cols"] = cols
                rows = v[1:]
            known = {i for i in cols.values() if i is not None}
            for r in rows:
                if not r or cols["name"] >= len(r) or not clean(r[cols["name"]]):
                    continue
                if cols["cat"] is not None and r[cols["cat"]]:
                    cur["_cat"] = clean(r[cols["cat"]])
                    cur["_pickcol"] = None
                # 표 안의 '택N' 칸 (구분 칸이 아닌 곳에 세로로 합쳐진 표시)
                for i, c in enumerate(r):
                    if i in known or not c:
                        continue
                    m = re.search(r"택\s*(\d)", clean(c))
                    if m:
                        cur["_pick"] = {"n": int(m.group(1)), "id": f"g{len(cur['courses'])}"}
                nm, alias = parse_course(r[cols["name"]])
                if not nm or nm in ("합계", "계"):
                    continue
                cr = credit_of(r[cols["credit"]]) if cols["credit"] is not None and cols["credit"] < len(r) else None
                c = {"name": nm, "credit": cr or 3}
                if alias:
                    c["alias"] = alias
                if cols["code"] is not None and cols["code"] < len(r) and clean(r[cols["code"]]):
                    c["code"] = clean(r[cols["code"]])
                if cols["univ"] is not None and cols["univ"] < len(r) and clean(r[cols["univ"]]) not in ("", "세종대"):
                    c["univ"] = clean(r[cols["univ"]])
                cat = cur.get("_cat")
                if cat:
                    m = re.search(r"\(?\s*택\s*(\d)\s*\)?", cat)
                    c["cat"] = clean(re.sub(r"\(?\s*택\s*\d\s*\)?", "", cat))
                    if m:
                        c["pick"] = int(m.group(1))
                        c["group"] = c["cat"]
                if cur.get("_pick") and "group" not in c:
                    c["pick"] = cur["_pick"]["n"]
                    c["group"] = cur["_pick"]["id"]
                cur["courses"].append(c)
    for p in programs:
        for k in [k for k in p if k.startswith("_")]:
            del p[k]
        # '24학점(8과목) 중 12학점(4과목) 이상 이수', '21학점 (9학점~15학점 이내 선택이수)' 처럼 일부만 들으면 되는 과정
        for n in p["notes"]:
            m = re.search(r"중\s*(\d+)\s*학점", n) or re.search(r"\(\s*(\d+)\s*학점\s*[~～-]\s*\d+\s*학점\s*이내", n)
            if m and n.startswith("이수학점"):
                p["listed"], p["credits"] = p["credits"], int(m.group(1))
        # 이수학점 전부 = 과목 학점 합이면 '모두 이수', 아니면 '학점 채우기'
        tot = sum(c["credit"] for c in p["courses"] if "group" not in c)
        groups = {}
        for c in p["courses"]:
            if "group" in c:
                groups.setdefault(c["group"], []).append(c)
        tot += sum(min(len(g), g[0]["pick"]) * g[0]["credit"] for g in groups.values())
        p["rule"] = "all" if p["credits"] and tot == p["credits"] else "credits"
        if p["id"] == "md04":  # 12학점 원칙, Capstone디자인(산학협력프로젝트) 6학점 포함 시 15학점
            p["rule"] = "all"
    programs = [p for p in programs if p["courses"]]
    data = {
        "updated": datetime.date.today().isoformat(),
        "semester": a.semester,
        "src": f"세종대학교 {a.semester}학기 수강편람 '마이크로디그리 이수 안내'·'AI 마이크로디그리 이수 안내'",
        "srcUrl": f"https://www.sejong.ac.kr/kor/intro/notice3.do?mode=view&articleNo={a.article}" if a.article else "",
        "rules": rules,
        "programs": programs,
    }
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(programs), "programs", sum(len(p["courses"]) for p in programs), "courses", file=sys.stderr)


if __name__ == "__main__":
    main()
