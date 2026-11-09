#!/usr/bin/env python3
"""현재 학기 개설 강좌(수강편람)를 모아 data/offered.json 을 만든다.

세종대 수강신청 사이트(sugang.sejong.ac.kr)는 외부에서 바로 받기 어려워서,
수강편람을 공개 API로 제공하는 올클(ALLCLL, https://www.allcll.kr)의 /api/subjects 를 사용한다.

    python3 tools/build_offered.py               # 올클에서 받기
    python3 tools/build_offered.py --file X.json # 받아 둔 응답 사용
    python3 tools/build_offered.py --season auto  # 계절학기(올클 /SUMMER_26/subjects.json 형식) → data/season.json
    python3 tools/build_offered.py --season WINTER_26
"""
import argparse, datetime, json, os, re, sys, urllib.request

SRC = "https://www.allcll.kr/api/subjects"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "offered.json")


SEASON_URL = "https://www.allcll.kr/{}/subjects.json"
SEASON_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "season.json")


def season_candidates(today):
    """지금 시점에 확인할 계절학기 코드 (가까운 것부터)"""
    y = today.year % 100
    if today.month <= 2:
        return [f"WINTER_{y - 1:02d}", f"SUMMER_{y - 1:02d}"]
    if today.month <= 8:
        return [f"SUMMER_{y:02d}", f"WINTER_{y - 1:02d}"]
    return [f"WINTER_{y:02d}", f"SUMMER_{y:02d}"]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "sejong-abeek-check (+https://ljw22112.github.io/sejong-ai-web/)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def group(subs):
    by = {}
    for s in subs:
        name = re.sub(r"\s+", "", s.get("subjectName") or "")
        if not name:
            continue
        cr = re.match(r"\s*(\d+(?:\.\d+)?)", s.get("tmNum") or "")
        by.setdefault(name, []).append({
            "cl": s.get("classCode") or "", "p": s.get("professorName") or "", "t": s.get("lesnTime") or "",
            "d": s.get("manageDeptNm") or "", "y": s.get("studentYear") or "", "k": s.get("curiTypeCdNm") or "",
            "cr": float(cr.group(1)) if cr else None,
        })
    return by


def build_season(code):
    codes = season_candidates(datetime.date.today()) if code == "auto" else [code]
    for c in codes:
        try:
            raw = fetch_json(SEASON_URL.format(c))
        except Exception as e:  # noqa
            print("없음", c, e, file=sys.stderr)
            continue
        subs = [s for s in raw.get("subjectResponses", []) if not s.get("isDeleted")]
        if not subs:
            continue
        kind, yy = c.split("_")
        year = 2000 + int(yy)
        label = f"{year} {'여름' if kind == 'SUMMER' else '겨울'}학기"
        out = {"updated": datetime.date.today().isoformat(), "code": c, "label": label,
               "term": f"{year}-{'하계' if kind == 'SUMMER' else '동계'}", "current": c == codes[0],
               "source": "올클(ALLCLL) 공개 계절학기 데이터 · 원 출처 세종대학교 수강편람", "sourceUrl": SEASON_URL.format(c),
               "count": len(subs), "courses": group(subs)}
        json.dump(out, open(SEASON_OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"wrote {SEASON_OUT}: {label} ({c}) {len(subs)} sections, current={out['current']}", file=sys.stderr)
        return
    sys.exit("계절학기 개설 강좌를 찾지 못했습니다.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--semester", help="예: 2026-2 (모르면 비워 둠)")
    ap.add_argument("--season", help="auto 또는 SUMMER_26 / WINTER_26 처럼")
    a = ap.parse_args()
    if a.season:
        return build_season(a.season)
    if a.file:
        raw = json.load(open(a.file, encoding="utf-8"))
    else:
        req = urllib.request.Request(SRC, headers={"User-Agent": "sejong-abeek-check (+https://ljw22112.github.io/sejong-ai-web/)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = json.loads(r.read().decode("utf-8"))
    subs = [s for s in raw.get("subjectResponses", []) if not s.get("isDeleted")]
    if len(subs) < 300:
        sys.exit(f"개설 강좌가 너무 적습니다({len(subs)}). 응답 형식이 바뀌었는지 확인하세요.")
    by = {}
    for s in subs:
        name = re.sub(r"\s+", "", s.get("subjectName") or "")
        if not name:
            continue
        cr = re.match(r"\s*(\d+(?:\.\d+)?)", s.get("tmNum") or "")
        by.setdefault(name, []).append({
            "cl": s.get("classCode") or "", "p": s.get("professorName") or "", "t": s.get("lesnTime") or "",
            "d": s.get("manageDeptNm") or "", "y": s.get("studentYear") or "", "k": s.get("curiTypeCdNm") or "",
            "cr": float(cr.group(1)) if cr else None,
        })
    out = {"updated": datetime.date.today().isoformat(), "semester": a.semester or "", "source": "올클(ALLCLL) 공개 수강편람 데이터 · 원 출처 세종대학교 수강편람",
           "sourceUrl": "https://www.allcll.kr", "count": len(subs), "courses": by}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(by)} courses, {len(subs)} sections, {os.path.getsize(OUT)} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
