/* 희망 진로별 과목 키워드. keywords 는 강하게(3점), related 는 약하게(1점) 반영된다. */
(function (root) {
  const T = [
    { id: "ai", families: ["sw", "robot", "ee"], label: "AI·머신러닝 엔지니어", keywords: ["기계학습", "머신러닝", "딥러닝", "인공지능", "강화학습", "자연어", "패턴인식", "신경망"], related: ["데이터", "확률", "선형대수", "영상처리", "파이썬"] },
    { id: "data", families: ["sw", "env", "energy", "civil"], label: "데이터 사이언티스트·분석가", keywords: ["데이터", "빅데이터", "통계", "데이터베이스", "마이닝", "시각화", "분석"], related: ["기계학습", "확률", "파이썬", "대용량"] },
    { id: "backend", families: ["sw"], label: "백엔드·클라우드 개발자", keywords: ["데이터베이스", "운영체제", "네트워크", "웹", "클라우드", "분산", "시스템프로그래밍", "소프트웨어공학", "오픈소스"], related: ["자료구조", "알고리즘", "JAVA", "자바", "보안"] },
    { id: "security", families: ["sw", "ee"], label: "정보보안 전문가", keywords: ["보안", "암호", "해킹", "포렌식", "정수론", "공개키"], related: ["네트워크", "운영체제", "시스템", "어셈블리"] },
    { id: "graphics", families: ["sw"], label: "게임·그래픽스·XR 개발자", keywords: ["그래픽스", "게임", "가상현실", "XR", "메타버스", "애니메이션", "HCI", "렌더링"], related: ["C\\+\\+", "객체지향", "영상"] },
    { id: "embedded", families: ["sw", "robot", "ee"], label: "임베디드·IoT 개발자", keywords: ["임베디드", "마이크로", "IoT", "디지털시스템", "컴퓨터구조", "논리회로", "실시간"], related: ["운영체제", "회로", "센서", "시스템"] },
    { id: "robotics", families: ["robot", "mech", "aero", "ee"], label: "로봇·자율주행 엔지니어", keywords: ["로봇", "로보틱스", "자율", "모빌리티", "제어", "드론", "무인", "메카트로닉스"], related: ["기계학습", "영상", "센서", "동역학", "SLAM"] },
    { id: "semicon", families: ["ee", "nano"], label: "반도체 소자·공정 엔지니어", keywords: ["반도체", "소자", "공정", "물리전자", "집적회로", "박막", "디스플레이"], related: ["전자기", "고체물리", "회로", "재료"] },
    { id: "circuit", families: ["ee"], label: "회로·하드웨어 설계", keywords: ["회로", "전자회로", "VLSI", "아날로그", "디지털논리", "전력"], related: ["신호", "반도체", "임베디드"] },
    { id: "comm", families: ["ee"], label: "통신·신호처리 엔지니어", keywords: ["통신", "신호", "무선", "안테나", "전자기", "디지털신호처리", "네트워크"], related: ["확률", "음성", "영상"] },
    { id: "mechdesign", families: ["mech", "aero"], label: "기계설계·해석(CAE)", keywords: ["설계", "고체역학", "유한요소", "CAD", "해석", "최적설계", "기계요소", "진동"], related: ["동역학", "재료", "제작"] },
    { id: "thermal", families: ["mech", "aero", "energy", "nuclear"], label: "열유체·에너지 시스템", keywords: ["열역학", "유체", "열전달", "에너지", "연소", "추진", "터보"], related: ["수치해석", "냉동", "발전"] },
    { id: "aerospace", families: ["aero"], label: "항공기·우주체계 엔지니어", keywords: ["항공", "우주", "위성", "로켓", "비행", "공기역학", "유도", "항법", "헬리콥터"], related: ["제어", "구조", "추진"] },
    { id: "nuclear", families: ["nuclear"], label: "원자력·방사선 엔지니어", keywords: ["원자로", "원자력", "방사선", "핵", "양자", "안전성", "열수력"], related: ["수치해석", "열전달", "재료"] },
    { id: "materials", families: ["nano"], label: "신소재·재료 연구개발", keywords: ["재료", "소재", "결정", "세라믹", "금속", "고분자", "나노", "상변태", "X선"], related: ["열역학", "화학", "물리"] },
    { id: "structure", families: ["civil", "arch"], label: "구조 엔지니어", keywords: ["구조", "역학", "콘크리트", "강구조", "철골", "내진", "교량", "철근"], related: ["설계", "재료", "해석"] },
    { id: "construction", families: ["civil", "arch"], label: "건설·시공·사업관리", keywords: ["시공", "건설관리", "경영", "사업관리", "적산", "공정", "BIM", "CAD"], related: ["재료", "측량"] },
    { id: "geotech", families: ["civil", "energy"], label: "지반·지하공간", keywords: ["토질", "지반", "기초공학", "암석", "지하", "터널", "지오메카닉스"], related: ["역학", "지질"] },
    { id: "water", families: ["civil", "env"], label: "수자원·물환경", keywords: ["수리", "수문", "물", "유체", "하천", "해안", "항만", "수처리", "수질"], related: ["기후", "환경"] },
    { id: "envtech", families: ["env", "civil", "energy"], label: "환경·기후 기술", keywords: ["환경", "대기", "기후", "온실가스", "폐기물", "토양", "영향평가", "신재생"], related: ["화학", "에너지", "통계"] },
    { id: "geoinfo", families: ["env", "energy", "civil"], label: "공간정보·원격탐사", keywords: ["공간정보", "GIS", "원격탐사", "위성", "측량", "GNSS", "매핑", "영상"], related: ["데이터", "빅데이터"] },
    { id: "resource", families: ["energy"], label: "자원개발·에너지자원", keywords: ["석유", "가스", "탐사", "자원", "광물", "지구화학", "지진", "물리탐사"], related: ["지질", "에너지", "데이터"] },
    { id: "building", families: ["arch"], label: "건축환경·설비", keywords: ["건축환경", "설비", "조명", "에너지", "공조", "음향"], related: ["열", "제어"] },
    { id: "research", families: ["sw", "robot", "ee", "arch", "civil", "env", "energy", "nuclear", "mech", "aero", "nano"], label: "대학원 진학·연구", keywords: ["연구", "논문", "특론", "수치해석", "졸업연구"], related: ["수학", "이론", "해석"] },
  ];
  const api = { tracks: T, forFamily: (f) => T.filter((t) => t.families.includes(f)) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CAREERS = api;
})(typeof self !== "undefined" ? self : this);
