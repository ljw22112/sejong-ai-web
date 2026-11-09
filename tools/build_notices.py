#!/usr/bin/env python3
"""공학교육센터 공지사항 최신 글을 모아 data/notices.json 을 만든다."""
import datetime, html, json, os, re, sys, urllib.request

LIST = "https://abeek.sejong.ac.kr/front/intronoticelist.do"
VIEW = "https://abeek.sejong.ac.kr/front/intronoticeview.do?noPkid={}"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "notices.json")


def main():
    with urllib.request.urlopen(LIST, timeout=30) as r:
        s = r.read().decode("cp949", errors="ignore")
    items = []
    for m in re.finditer(r"noPkid=(\d+)[^>]*>(.*?)</a>", s, re.S):
        t = html.unescape(re.sub(r"<[^>]+>|\s+", " ", m.group(2))).strip()
        title = re.split(r"\s+번호\s*:", t)[0].strip()
        date = re.search(r"작성일\s*:\s*(\d{4}\.\d{2}\.\d{2})", t)
        if title and not any(i["id"] == m.group(1) for i in items):
            items.append({"id": m.group(1), "title": title, "date": date.group(1) if date else "", "url": VIEW.format(m.group(1))})
    if not items:
        sys.exit("공지를 찾지 못했습니다. 페이지 구조가 바뀌었는지 확인하세요.")
    json.dump({"updated": datetime.date.today().isoformat(), "source": LIST, "items": items[:8]},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", len(items[:8]), "notices", file=sys.stderr)


if __name__ == "__main__":
    main()
