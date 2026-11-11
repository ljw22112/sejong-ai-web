#!/usr/bin/env python3
"""세종대 공학교육센터(abeek.sejong.ac.kr)의 '교과과정/공학인증요건' 페이지를 수집해
data/abeek.json 을 만든다.

사용법:
    pip install beautifulsoup4
    python3 tools/build_data.py                # 사이트에서 새로 수집
    python3 tools/build_data.py --cache DIR    # 이미 받아 둔 HTML(DIR/y_programXX02_N.html) 사용

매년 3월 새 학번 기준이 올라오면 한 번 다시 돌리면 된다.
자동 추출이 틀린 부분은 tools/overrides.json 에 적으면 마지막에 덮어쓴다.
"""
import argparse, json, os, re, sys, urllib.request
from bs4 import BeautifulSoup

BASE = "https://abeek.sejong.ac.kr/abeek/"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "abeek.json")

# 공학교육센터 사이트의 프로그램 번호 → (프로그램명, 학과명, 진로 계열)
PROGRAMS = {
    "03": ("컴퓨터공학심화", "컴퓨터공학과", "sw"),
    "05": ("소프트웨어심화", "콘텐츠소프트웨어학과(소프트웨어학과)", "sw"),
    "06": ("정보보호학심화", "정보보호학과", "sw"),
    "16": ("데이터사이언스심화", "데이터사이언스학과", "sw"),
    "18": ("인공지능심화", "인공지능학과", "sw"),
    "17": ("AI로봇학심화", "AI로봇학과", "robot"),
    "19": ("전자정보통신공학심화", "AI융합전자공학과(전자정보통신공학과)", "ee"),
    "07": ("건축공학심화", "건축공학과", "arch"),
    "08": ("토목공학심화", "건설환경공학과", "civil"),
    "10": ("환경융합공학심화", "환경융합공학과(환경에너지공간융합학과)", "env"),
    "11": ("에너지자원공학심화", "에너지자원공학과(지구자원시스템공학과)", "energy"),
    "12": ("원자력공학심화", "양자원자력공학과", "nuclear"),
    "13": ("기계공학심화", "기계공학과", "mech"),
    "14": ("항공우주공학심화", "우주항공공학전공", "aero"),
    "15": ("나노신소재공학심화", "나노신소재공학과", "nano"),
}
YEARS = range(2021, 2027)

# 공학교육센터 공지에 적힌 운영 종료/대상 제한 (사이트 원문 요약)
STATUS = {
    "06": "2024학번부터 교과과정이 인증 요건을 반영하지 않아 2027년 2월 28일 졸업생까지만 공학인증 졸업 가능",
    "16": "학과 통합으로 데이터사이언스학과 2023학번까지만 인증 가능, 2028년 2월 프로그램 종료 예정(이수학점은 2026년 기준 적용)",
    "18": "2021~2023학번 기준만 게시됨(이후 학과 개편)",
}

STD_GE_ELECTIVE = ["세계사", "동서양의사상과윤리", "경제학", "경영학", "컴퓨터게임과메타버스", "융합예술의이해"]


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("cp949", errors="ignore")


def page(cache, name):
    if cache:
        p = os.path.join(cache, name if name.startswith("idx") else "y_" + name)
        if os.path.exists(p):
            return open(p, encoding="utf-8", errors="ignore").read()
    return fetch(BASE + name)


def grid(table):
    """rowspan/colspan 을 펼친 2차원 셀 목록."""
    out, pend = [], {}
    num = lambda v: int((re.match(r"\d+", str(v or "1").strip()) or re.match("1", "1")).group())
    for tr in table.find_all("tr"):
        cells, row, ci, k = tr.find_all(["td", "th"], recursive=False), [], 0, 0
        while k < len(cells) or ci in pend:
            if ci in pend:
                txt, left = pend[ci]
                row.append(txt)
                if left <= 1:
                    del pend[ci]
                else:
                    pend[ci] = (txt, left - 1)
                ci += 1
                continue
            c = cells[k]; k += 1
            txt = c.get_text(" ", strip=True)
            rs, cs = num(c.get("rowspan")), num(c.get("colspan"))
            for _ in range(cs):
                row.append(txt)
                if rs > 1:
                    pend[ci] = (txt, rs - 1)
                ci += 1
        out.append(row)
    return out


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


# ---------- 과목명 목록 추출 ----------
NOISE = re.compile(r"인증|이수|학점|이상|과목|포함|영역|순서|필수|선택|설계|참고|권장|교과|기준|조건|아래|위 |해당|수강|병수|미인정|가능|요망|운영|예정|단,|한 과목|전공|교양|MSC|BSM|※|입학자|이수체계")


GENERIC = {"수학", "기초과학", "전산학", "수학 및 기초과학", "인문", "사회"}


def nkey(s):
    """과목명 비교용 키: 공백/기호 제거, 로마숫자→숫자."""
    s = (s or "").replace("Ⅰ", "1").replace("Ⅱ", "2").replace("Ⅲ", "3")
    s = re.sub(r"[\s·ㆍ:：\-_,.'\"‘’“”\[\]]", "", s).lower()
    return s


def dedupe(names):
    out, seen = [], set()
    for n in names:
        k = nkey(n)
        if k and k not in seen:
            seen.add(k); out.append(n)
    return out


GE_CANON = [("문제해결을위한글쓰기와발표", ["문제해결을위한글쓰기와발표", "비판적사고와창의적글쓰기", "비판적사고와글쓰기"]),
            ("서양철학:쟁점과토론", ["서양철학:쟁점과토론"]),
            ("대학영어", ["대학영어"])]


def balance(p):
    p = p.strip("[]<> ")
    while p.endswith(")") and p.count(")") > p.count("("):
        p = p[:-1].strip()
    while p.startswith("(") and p.count("(") > p.count(")"):
        p = p[1:].strip()
    if p.count("(") > p.count(")"):
        p = p + ")"
    return p.strip()


def names_from(text):
    """'미적분학1(3), 일반물리학1(3)…' 같은 문장에서 과목명만 뽑는다."""
    t = re.sub(r"\((?:\s*\d+(?:\.\d+)?\s*(?:[,\-/]\s*(?:설계\s*)?\d+(?:\.\d+)?\s*(?:학점)?)?\s*)\)", "", text)  # (3) (3-3) (3, 설계1)
    t = re.sub(r"\(\s*\d\s*-\s*\d\s*\)", "", t)  # (1-1)
    t = re.sub(r"\((?:역사와사상|경제와사회|문화와예술)[^)]*\)|\[(?:역사와사상|경제와사회|문화와예술)[^\]]*\]", ",", t)
    t = re.sub(r"(역사와\s*사상|경제와\s*사회|문화와\s*예술)\s*(영역)?\s*[:：]", ",", t)
    parts = re.split(r"[,，、;/▪◇•\n]|\s{2,}", t)
    out = []
    for p in parts:
        p = clean(p).strip("*-–·:： ")
        p = re.sub(r"^(?:\d\)|[-*]|\d\.)\s*", "", p)
        p = balance(re.sub(r"^\d+(?:\.\d+)?\s+", "", p))
        if p in GENERIC:
            continue
        if not p or len(p) > 40 or len(p) < 2:
            continue
        if NOISE.search(p) and not re.search(r"(설계기초|기초설계$|종합설계[A-B12]?$|Capstone|캡스톤|공학설계[AB]|창의설계|설계및|설계\d|설계$)", p):
            continue
        if re.fullmatch(r"[\d\s.()\-]+", p):
            continue
        out.append(p)
    return list(dict.fromkeys(out))


def section(text, start, stops):
    m = re.search(start, text)
    if not m:
        return ""
    rest = text[m.end():]
    cut = len(rest)
    for s in stops:
        mm = re.search(s, rest)
        if mm:
            cut = min(cut, mm.start())
    return rest[:cut]


def num_after(s):
    m = re.search(r"(\d+(?:\.\d+)?)", s or "")
    return float(m.group(1)) if m else None


def design_min(s):
    s = s or ""
    for pat in (r"^\s*\d+\s*(?:학점)?\s*\(\s*(?:설계\s*)?(\d+(?:\.\d+)?)",
                r"설계(?:학점|교과목)?[^\d]{0,12}?(\d+(?:\.\d+)?)\s*학점\s*이상",
                r"설계\s*(\d+(?:\.\d+)?)\s*(?:학점)?\s*\)"):
        m = re.search(pat, s)
        if m:
            return float(m.group(1))
    return None


def parse_credit(s):
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?", s or "")
    if not m:
        return None, 0.0
    return float(m.group(1)), float(m.group(2) or 0)


def area_of(a, cert, name):
    a = (a or "") + " " + (cert or "")
    if re.search(r"MSC|BSM|BMS", a):
        return "MSC"
    if "전공" in a or re.search(r"전[필선]", a):
        return "MAJOR"
    if "교양" in a or "교필" in a or "교선" in a or "공통필수" in a:
        return "GE"
    return None


def parse_page(html):
    soup = BeautifulSoup(html, "html.parser")
    full = clean(soup.get_text(" "))
    notice = ""
    m = re.search(r"(프로그램 공지사항.*?)(?=\d{4}(?:학)?년도 공학인증요건)", full)
    if m:
        notice = m.group(1)[:900]
    summary, courses = {}, []
    for t in soup.find_all("table"):
        g = grid(t)
        flat = " ".join(" ".join(r) for r in g[:3])
        if "교과목명" in flat or ("교과목" in flat and "학점" in flat and "학기" in flat):
            hi = next((k for k, r in enumerate(g) if any("교과목" in c for c in r)), None)
            if hi is None:
                continue
            h = g[hi]
            col = lambda *ks: next((k for k, c in enumerate(h) if any(x in c for x in ks)), None)
            ny, ns, na, nc, nn, ncr = col("학년"), col("학기"), col("교과구분", "이수구분", "교과영역"), col("인증구분"), col("교과목"), col("학점")
            for r in g[hi + 1:]:
                get = lambda n: r[n] if n is not None and n < len(r) else ""
                nm = clean(get(nn))
                if not nm or len(nm) > 50 or re.search(r"소계|합계|^계$|총계", nm) or re.search(r"소계|합계", get(0)):
                    continue
                cr, ds = parse_credit(get(ncr))
                if cr is None:
                    continue
                yr, sm = get(ny), get(ns)
                courses.append({
                    "name": re.sub(r"^\[[^\]]+\]\s*", "", nm),
                    "year": int(yr) if yr.strip().isdigit() else None,
                    "sem": int(sm) if sm.strip().isdigit() else None,
                    "area": area_of(get(na), get(nc), nm),
                    "req": get(nc).strip().startswith("인필") or get(nc).strip().startswith("인증필수"),
                    "credit": cr, "design": ds,
                })
        elif "최소" in flat or "이수학점" in flat:
            for r in g:
                if not r:
                    continue
                head, cells = clean(r[0]), list(dict.fromkeys(clean(c) for c in r[1:]))
                body = " ".join(cells)
                key = None
                if re.search(r"인증\s*최소", head):
                    key = "TOTAL"
                elif re.search(r"MSC|BSM|BMS|기초과학", head):
                    key = "MSC"
                elif head.startswith("전공"):
                    key = "MAJOR"
                elif "교양" in head:
                    key = "GE"
                if key:
                    prev = summary.get(key)
                    summary[key] = (prev + " " + body) if prev else body
    return full, notice, summary, courses


DESIGN_BASIC = re.compile(r"공학설계기초|SW설계기초|창의SW기초설계|기초창의설계|건축기초설계|공학기초설계실험|금속과세라믹기초설계|^기초설계$")
DESIGN_CAP = re.compile(r"Capstone|캡스톤|종합설계|공학설계[AB]|스마트시티프로젝트|창의연구")


def build_rule(pid, year, html):
    full, notice, s, courses = parse_page(html)
    # 이수체계표의 중복 행 정리
    seen, cat = set(), []
    for c in courses:
        k = (c["name"], c["year"], c["sem"])
        if k in seen:
            continue
        seen.add(k); cat.append(c)

    ge_txt, msc_txt, mj_txt = s.get("GE", ""), s.get("MSC", ""), s.get("MAJOR", "")
    rule = {
        "ge": {"min": num_after(ge_txt) or 14},
        "msc": {"min": num_after(msc_txt)},
        "major": {"min": num_after(mj_txt), "designMin": design_min(mj_txt)},
        "totalMin": num_after(s.get("TOTAL", "")),
        "notes": {k: v for k, v in {"GE": ge_txt, "MSC": msc_txt, "MAJOR": mj_txt, "TOTAL": s.get("TOTAL", ""), "notice": notice}.items() if v},
    }

    # 전문교양
    flat_ge = nkey(ge_txt)
    req = []
    for canon, alts in GE_CANON:
        hit = next((a for a in alts if nkey(a) in flat_ge), None)
        if hit:
            req.append(hit)
    elec = [n for n in STD_GE_ELECTIVE if n in ge_txt.replace(" ", "")]
    pick = re.search(r"(\d)\s*(?:개\s*)?과목\s*이상", ge_txt)
    if not req:  # '프로그램지정 인증필수과목 포함'처럼 과목명이 없을 때: 공통 3과목
        req = [c[0] for c in GE_CANON]
    rule["ge"].update({"required": req, "electives": elec, "pickN": int(pick.group(1)) if pick and elec else 0})

    # MSC/BSM
    if re.search(r"인증\s*필수|필수\s*[:：]", msc_txt):
        r_part = section(msc_txt, r"(?:인증\s*필수|BSM\s*필수|필수)\s*[:：|]?", [r"인증\s*선택", r"선택\s*[:：|]", r"\(위 ", r"※"])
        e_part = section(msc_txt, r"(?:인증\s*선택|(?<!필수)선택)\s*[:：|]?", [r"\(위 ", r"※", r"\(이 중"])
    else:
        r_part, e_part = msc_txt, ""
    mreq = names_from(r_part)
    mel = names_from(e_part)
    # 표에서 'MSC 인필'로 표시된 과목 보충
    for c in cat:
        if c["area"] == "MSC":
            (mreq if c["req"] else mel).append(c["name"]) if c["name"] not in mreq + mel else None
    one_of = bool(re.search(r"이 중 반드시\s*['‘]?한 과목", msc_txt))
    mreq = dedupe(mreq)
    rk = {nkey(x) for x in mreq}
    rule["msc"].update({"required": mreq, "electives": [x for x in dedupe(mel) if nkey(x) not in rk],
                        "electiveAtLeastOne": one_of})

    # 설계
    basic = names_from(section(mj_txt, r"기초\s*설계\s*(?:\([^)]*\))?\s*[:：–\-]", [r"요소\s*설계", r"종합\s*설계"]))
    element = names_from(section(mj_txt, r"요소\s*설계\s*(?:\([^)]*\))?\s*[:：–\-]", [r"종합\s*설계", r"\(b\)", r"※", r"▪ 설계교과목"]))
    cap = names_from(section(mj_txt, r"종합\s*설계\s*(?:\([^)]*\))?\s*[:：–\-]", [r"<유의", r"※", r"⇒", r"\(b\)", r"▪", r"\(위 ", r"\* 설계"]))
    for c in cat:
        if c["area"] == "MAJOR" and c["design"] > 0:
            if DESIGN_BASIC.search(c["name"]) and not basic:
                basic.append(c["name"])
            elif DESIGN_CAP.search(c["name"]) and c["design"] >= 3:
                cap.append(c["name"])
    basic = dedupe([b for b in basic if DESIGN_BASIC.search(b) or len(basic) == 1])
    cap = dedupe([c for c in cap if DESIGN_CAP.search(c) or len(cap) == 1])
    cap_one = len(cap) > 1 and bool(re.search(r"(중\s*(하나|한\s*과목|택\s*1)|택\s*1|한 과목만|\bor\b)", mj_txt))
    bk = {nkey(x) for x in basic + cap}
    rule["design"] = {"basic": basic, "element": [e for e in dedupe(element) if nkey(e) not in bk], "capstone": cap, "capstoneAnyOf": cap_one}

    # 전공 필수: 표의 '인필' 전공 + 요건 문장의 '인증필수' 목록
    mj_req = [c["name"] for c in cat if c["area"] == "MAJOR" and c["req"]]
    mj_req += names_from(section(mj_txt, r"인증\s*필수(?:\s*교과목)?\s*[:：-]", [r"\*", r"-\s*설계", r"※", r"전공이론"]))
    capk = {nkey(c) for c in cap}
    rule["major"]["required"] = [x for x in dedupe(mj_req) if not (cap_one and nkey(x) in capk)]

    # 설계학점을 요건 문장에서 보충 '(3, 설계1.5)' '(3/1)'
    dcred = {}
    for nm, d in re.findall(r"([가-힣A-Za-z0-9:\-]+(?:\([가-힣A-Za-z]+\))?)\s*\(\s*\d+\s*(?:,\s*설계\s*|/)\s*(\d+(?:\.\d+)?)", mj_txt):
        dcred[nm] = float(d)
    for nm, d in re.findall(r"([가-힣A-Za-z0-9:\-]+(?:\([가-힣A-Za-z]+\))?)\s*\(\s*\d+\s*-\s*(\d+)\s*\)", mj_txt):
        dcred.setdefault(nm, float(d))
    # '요소설계(설계 2학점): A, B' 처럼 묶음 머리에 적힌 설계학점
    for label, lst in (("기초", basic), ("요소", element), ("종합", cap)):
        m = re.search(label + r"\s*설계\s*\(\s*(?:각\s*)?설계\s*(\d+(?:\.\d+)?)", mj_txt)
        if m:
            for nm in lst:
                if not any(nkey(k) == nkey(nm) for k in dcred):
                    dcred[nm] = float(m.group(1))
    rule["designCredits"] = dcred
    # 선후수 지정(설계 순서 외): 'A→B' 형태
    pre = []
    for a, b in re.findall(r"([가-힣A-Za-z0-9]+)\s*→\s*([가-힣A-Za-z0-9]+)", s.get("MSC", "") + " " + mj_txt):
        if re.search(r"설계|캡스톤|Capstone|요소|종합", a + b) or a in ("이상", "이하") or len(a) < 2 or len(b) < 2:
            continue
        if (a, b) not in pre:
            pre.append((a, b))
    rule["prereqs"] = [list(x) for x in pre]
    rule["catalog"] = cat
    return rule


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    a = ap.parse_args()
    import datetime
    data = {"source": "https://abeek.sejong.ac.kr (교과과정/공학인증요건)", "updated": datetime.date.today().isoformat(), "programs": {}}
    for pid, (pname, dept, family) in PROGRAMS.items():
        idx = page(a.cache, f"idx{pid}.html") if a.cache and os.path.exists(os.path.join(a.cache, f"idx{pid}.html")) else fetch(f"{BASE}program{pid}02.html")
        links = re.findall(r'href="\s*(program' + pid + r'02_\d+\.html)\s*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]*)', idx)
        years = {}
        for f, label in links:
            y = re.sub(r"\D", "", label)[:4]
            if not y or int(y) not in YEARS:
                continue
            try:
                html = page(a.cache, f)
            except Exception as e:  # noqa
                print("skip", f, e, file=sys.stderr); continue
            r = build_rule(pid, int(y), html)
            r["src"] = BASE + f
            r["pid"] = pid
            years[y] = r
        # 이수체계표가 그림/누락인 연도는 가장 가까운 연도의 표를 빌려 쓴다(추천용)
        have = [y for y in years if years[y]["catalog"]]
        for y, r in years.items():
            if not r["catalog"] and have:
                near = min(have, key=lambda h: (abs(int(h) - int(y)), -int(h)))
                r["catalog"] = years[near]["catalog"]
                r["catalogFrom"] = near
        data["programs"][pid] = {"name": pname, "dept": dept, "family": family, "status": STATUS.get(pid, ""), "years": years}
        print(pid, pname, sorted(years), file=sys.stderr)

    ov = os.path.join(HERE, "overrides.json")
    if os.path.exists(ov):
        for pid, ys in json.load(open(ov, encoding="utf-8")).items():
            if pid.startswith("_"):
                continue
            for y, patch in ys.items():
                tgt = data["programs"][pid]["years"].get(y)
                if tgt is None:
                    continue
                for path, val in patch.items():
                    d = tgt
                    keys = path.split(".")
                    for k in keys[:-1]:
                        d = d.setdefault(k, {})
                    d[keys[-1]] = val
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("wrote", os.path.abspath(OUT), os.path.getsize(OUT), "bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
