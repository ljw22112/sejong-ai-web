#!/usr/bin/env python3
"""세종대 '연도별 교과과정' 페이지에서 학과 졸업요건을 수집해 data/grad.json 을 만든다.

    python3 tools/build_grad.py               # 사이트에서 수집
    python3 tools/build_grad.py --cache DIR   # DIR/cYYYY.html 사용

아직 게시되지 않은 연도는 가장 가까운 이전 연도 기준을 복사하고 'from' 에 출처 연도를 남긴다.
"""
import argparse, datetime, json, os, re, sys, urllib.request
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_data import grid  # noqa: E402

URL = "https://www.sejong.ac.kr/kor/academics/curriculum{}.do"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "grad.json")
YEARS = range(2021, 2027)


def num(s):
    m = re.search(r"\d+", s or "")
    return int(m.group()) if m else 0


def clean(s):
    return re.sub(r"\s+", "", s or "")


def parse(html):
    b = BeautifulSoup(html, "html.parser")
    if "요청하신 페이지를 찾을 수 없습니다" in html or len(html) < 5000:
        return None
    text = re.sub(r"\s+", " ", b.get_text(" "))
    out = {"common": [], "depts": {}, "cert": None, "balanceNote": ""}

    # 졸업인증제
    if re.search(r"중\s*2개\s*이상\s*통과", text):
        out["cert"] = {"pick": 2, "items": ["영어졸업인증", "고전독서졸업인증", "소프트웨어코딩졸업인증"]}
    elif "영어졸업인증" in text and "고전독서" in text:
        out["cert"] = {"pick": 2, "items": ["영어졸업인증", "고전독서인증"],
                       "note": "이 학번 교과과정에는 영어·고전독서 인증이 모두 적혀 있습니다. 이후 개편 기준 적용 여부는 학과에 확인하세요."}
    m = re.search(r"균형교양 (자신의 소속계열과 다른[^.]*?이수[^)]*\)?)", text)
    if m:
        out["balanceNote"] = m.group(1)

    for t in b.find_all("table"):
        cap = t.find("caption")
        cap = cap.get_text(" ", strip=True) if cap else ""
        g = grid(t)
        if not g:
            continue
        head = [clean(c) for c in g[0]]
        # 공통필수(교양필수) 과목
        if not out["common"] and re.search(r"(공통필수|교양필수|계열별 필수과목) 과목 이수|계열별 필수과목 이수", cap) and "외국" not in cap:
            ci = next((i for i, h in enumerate(head) if h in ("과목명", "과목")), None)
            cr = next((i for i, h in enumerate(head) if h == "학점"), None)
            if ci is not None and cr is not None:
                for r in g[1:]:
                    n = clean(r[ci]) if ci < len(r) else ""
                    if not n or "합계" in n:
                        continue
                    out["common"].append({"name": n, "credit": num(r[cr])})
        # 학과별 이수학점 (같은 페이지에 옛 기준 표가 더 있으면 첫 표만)
        if "단일전공 이수시 학과별" in cap and not out["depts"]:
            h2 = [clean(c) for c in g[1]] if len(g) > 1 else []
            new_fmt = "기초(A)" in h2
            start = 2 if new_fmt else 1
            for r in g[start:]:
                r = [clean(c) for c in r]
                if len(r) < 8:
                    continue
                # 단과대학/학과 칸 순서가 뒤바뀐 행 대비
                dept = r[1] if not re.search(r"대학$", r[1]) else r[0]
                if not dept or re.fullmatch(r"\d+", dept):
                    continue
                if new_fmt:
                    out["depts"][dept] = {"geCommon": num(r[2]), "geBalance": num(r[3]), "geBasic": num(r[4]),
                                          "majorBasic": num(r[5]), "majorReq": num(r[6]), "majorElec": num(r[7]),
                                          "majorTotal": num(r[8]), "grad": num(r[10]) if len(r) > 10 else 130}
                else:
                    labels = head
                    old = "교양선택" in "".join(labels)
                    out["depts"][dept] = {"geCommon": num(r[2]), "geBalance": 0 if old else num(r[3]),
                                          "geElective1": num(r[3]) if old else 0, "geBasic": num(r[4]),
                                          "majorBasic": 0, "majorReq": num(r[6]), "majorElec": num(r[7]),
                                          "majorTotal": num(r[5]), "grad": num(r[8])}
    return out


COMMON_VOCAB = ["세종인을위한진로설계", "세종인을위한전공탐색", "대학영어", "창업과기업가정신", "창업과기업가정신1", "비판적사고와창의적글쓰기",
                "문제해결을위한글쓰기와발표", "서양철학:쟁점과토론", "취창업과진로역량개발", "취창업과진로설계", "우주자연인간",
                "신입생세미나A", "신입생세미나B", "EnglishListeningPractice1", "EnglishReadingPractice1", "신입생세미나", "대학생활과진로설계"]


COLLEGES = ["인문과학대학", "사회과학대학", "경영경제대학", "호텔관광대학", "자연과학대학", "생명과학대학", "전자정보공학대학",
            "소프트웨어융합대학", "인공지능융합대학", "공과대학", "예체능대학", "인문과학", "사회과학", "경영경제", "호텔관광", "자연과학",
            "생명과학", "전자정보공학", "전자정보", "공학대학", "소프트웨어융합", "소프트웨어", "연계융합전공", "연계융합", "융합대학", "인공지능융합", "공과", "예체능", "대학", "단과대학"]


KNOWN = set()
try:  # 이미 아는 학과명 (벌어진 글자·단과대학 칸을 떼어낼 때 기준)
    for _y in json.load(open(OUT, encoding="utf-8"))["years"].values():
        KNOWN.update(_y["depts"])
except Exception:  # noqa
    pass


def dept_name(raw):
    """'인문과학 대  학    역 사 학 과' 처럼 글자 사이가 벌어진 칸에서 학과명만 뽑는다."""
    s = re.sub(r"\s+", "", raw)
    cands = [s]
    changed = True
    while changed:
        changed = False
        for c in sorted(COLLEGES, key=len, reverse=True):
            if s.startswith(c) and len(s) > len(c) + 1:
                s = s[len(c):]; cands.append(s); changed = True
                break
    ok = [c for c in cands if re.search(r"(학과|전공|학부|과정)$", c) and len(c) >= 3]
    if not ok:
        return None
    known = [c for c in ok if c in KNOWN]
    return known[0] if known else ok[-1]


def parse_catalog(txt):
    """수강편람 PDF 텍스트(pdftotext -layout)의 '❚ YYYY학년도 입학자 교과과정' 절에서 학과별 학점과 공통필수 과목을 읽는다."""
    out = {}
    parts = re.split(r"❚\s*(\d{4})학년도 입학자 교과과정", txt)
    for i in range(1, len(parts), 2):
        y, body = parts[i], parts[i + 1]
        block = re.sub(r"\s+", "", body[:body.find("계열별")] if "계열별" in body[:4000] else body[:2500])
        vocab = sorted(COMMON_VOCAB, key=len, reverse=True)
        found, used = [], []
        for v in vocab:
            for m2 in re.finditer(re.escape(v), block):
                if any(m2.start() < e and s0 < m2.end() for s0, e in used):
                    continue
                used.append((m2.start(), m2.end())); found.append((m2.start(), v))
        common = [v for _, v in sorted(found)]
        depts = {}
        mpos = re.search(r"단일전공\s*이수\s*시\s*학과별", body)
        t = body[mpos.start():] if mpos else ""
        lines = t.split("\n")[:160]
        old = "교양선택" in "".join(lines[:8])  # 2021학번 이전: 공통 / 교양선택(1영역) / 학문기초 ...
        for line in lines:
            mm = re.search(r"^(.*?[가-힣A-Za-z)])\s+((?:\d+\s+){6,8}\d+)\s*$", line.strip())
            if not mm:
                continue
            n = dept_name(mm.group(1))
            if not n:
                continue
            v = [int(x) for x in mm.group(2).split()]
            if len(v) == 9:
                depts[n] = {"geCommon": v[0], "geBalance": v[1], "geBasic": v[2], "majorBasic": v[3], "majorReq": v[4],
                            "majorElec": v[5], "majorTotal": v[6], "grad": v[8]}
            elif len(v) == 7:  # 공통 | 균형(또는 교양선택1영역) | 학문기초 | 전공계 | 전필 | 전선 | 졸업
                depts[n] = {"geCommon": v[0], "geBalance": 0 if old else v[1], "geBasic": v[2], "majorBasic": 0,
                            "majorReq": v[4], "majorElec": v[5], "majorTotal": v[3], "grad": v[6]}
                if old:
                    depts[n]["geElective1"] = v[1]
                else:
                    depts[n]["geElective1"] = 0
        if depts:
            out[y] = {"common": common, "depts": depts}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    ap.add_argument("--catalog", nargs="+", help="수강편람 PDF를 pdftotext -layout 으로 바꾼 텍스트 파일 (웹에 없는 학번 보충)")
    a = ap.parse_args()
    years = {}
    for y in YEARS:
        html = None
        if a.cache and os.path.exists(os.path.join(a.cache, f"c{y}.html")):
            html = open(os.path.join(a.cache, f"c{y}.html"), encoding="utf-8", errors="ignore").read()
        else:
            try:
                with urllib.request.urlopen(URL.format(y), timeout=30) as r:
                    html = r.read().decode("utf-8", errors="ignore")
            except Exception as e:  # noqa
                print("skip", y, e, file=sys.stderr)
        p = parse(html) if html else None
        if p and p["depts"]:
            p["src"] = URL.format(y)
            years[str(y)] = p
            print(y, len(p["depts"]), "depts,", len(p["common"]), "common", file=sys.stderr)
    if a.catalog:
        # 학기 순서대로 읽어 같은 학번은 가장 최근 수강편람 값을 쓴다 (수강편람이 웹 교과과정 페이지보다 우선)
        latest = {}
        for f in sorted(a.catalog):
            sem = re.search(r"(20\d\d)[_-]?([12])", os.path.basename(f))
            sem = f"{sem.group(1)}-{sem.group(2)}" if sem else os.path.basename(f)
            for y, c in parse_catalog(open(f, encoding="utf-8").read()).items():
                if int(y) in YEARS:
                    latest[y] = (sem, c)
        for y in YEARS:
            if str(y) not in latest:
                continue
            sem, c = latest[str(y)]
            if str(y) in years:
                web = years[str(y)]
                diff = {}
                for n, v in c["depts"].items():
                    old = web["depts"].get(n)
                    if old is None:
                        web["depts"][n] = v
                        continue
                    d = {k: [old.get(k), v[k]] for k in v if old.get(k) != v[k] and not (k == "geElective1" and not v[k] and not old.get(k))}
                    if d:
                        diff[n] = d
                        web["depts"][n] = dict(old, **v)
                web["catalog"] = sem
                if diff:
                    web["catalogDiff"] = diff
                    print(y, "catalog", sem, "overrides", diff, file=sys.stderr)
                continue
            prev = years.get(str(y - 1), {})
            credit = {x["name"]: x["credit"] for x in prev.get("common", [])}
            alias = {"창업과기업가정신": "창업과기업가정신1", "비판적사고와창의적글쓰기": "문제해결을위한글쓰기와발표", "취창업과진로역량개발": "취창업과진로설계"}
            common = [{"name": n, "credit": credit.get(n, credit.get(alias.get(n, ""), 1))} for n in dict.fromkeys(c["common"])]
            years[str(y)] = {"common": common, "depts": c["depts"], "cert": prev.get("cert"), "balanceNote": "", "catalog": sem,
                             "src": f"세종대학교 {sem}학기 수강편람 '입학년도별 교과과정 안내'"}
            print(y, "from catalog", sem, len(c["depts"]), "depts,", len(common), "common", file=sys.stderr)
    for y in YEARS:
        if str(y) not in years:
            prev = [k for k in years if int(k) < y]
            if prev:
                k = max(prev)
                years[str(y)] = dict(years[k], **{"from": k})
                print(y, "copied from", k, file=sys.stderr)
    json.dump({"updated": datetime.date.today().isoformat(), "years": years}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("wrote", os.path.abspath(OUT), file=sys.stderr)


if __name__ == "__main__":
    main()
