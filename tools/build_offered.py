#!/usr/bin/env python3
"""현재 학기 개설 강좌(수강편람)를 모아 data/offered.json 을 만든다.

세종대 수강신청 사이트(sugang.sejong.ac.kr)는 외부에서 바로 받기 어려워서,
수강편람을 공개 API로 제공하는 올클(ALLCLL, https://www.allcll.kr)의 /api/subjects 를 사용한다.

    python3 tools/build_offered.py               # 올클에서 받기
    python3 tools/build_offered.py --file X.json # 받아 둔 응답 사용
"""
import argparse, datetime, json, os, re, sys, urllib.request

SRC = "https://www.allcll.kr/api/subjects"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "offered.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--semester", help="예: 2026-2 (모르면 비워 둠)")
    a = ap.parse_args()
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
