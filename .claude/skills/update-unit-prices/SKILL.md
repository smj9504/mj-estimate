---
name: update-unit-prices
description: Use when the user asks to review or raise unit prices for an estimate domain (Kitchen Cabinet, Packing Estimate, etc.) — typically a monthly recurring check ("이번 달 unit price 리서치해서 올려줘", "가격 업데이트 리마인드"). Drives web research into current market/cost trends, proposes a category-tiered increase (always within a 1%-5% band unless the user names a different range), gets explicit user sign-off before touching any file, then updates every file in that domain's price fallback chain — including hidden fallback tables the DB seeder is not the only source of truth for.
---

# Unit Price 월간 업데이트

이 프로젝트는 견적 도메인마다 unit price가 **한 곳에만 있지 않다.** DB 시딩용 원본 외에, 서비스 계산 로직 안에 자체 하드코딩된 fallback 테이블, PDF/Excel export용 legacy fallback, 코드 곳곳의 인라인 `get_price(...) or <literal>` 등이 동일한 값을 중복 보관한다. 이 중 하나만 고치면 "DB에 가격이 없는 상황(fallback 경로)"에서 옛날 가격이 실제 견적서에 그대로 나갈 수 있다. 이 스킬은 그 전체 체인을 빠짐없이 찾아 동기화하는 절차다.

## 실행 절차

### 1. 대상 도메인 확정
사용자가 도메인을 지정하지 않았으면 물어본다. 아래 "알려진 대상"에 있으면 그 파일 목록에서 시작하되, **매번 grep으로 최신 상태를 재확인한다** — 마지막 업데이트 이후 파일이 추가/이동됐을 수 있다.

### 2. Fallback 체인 전수조사 (가장 중요, 절대 생략 금지)
1. 도메인의 핵심 가격 상수 파일(보통 `pricing.py` 또는 `seed_prices.py`)을 Read.
2. 그 파일의 대표 가격 값 몇 개(예: `57.31`, `4.82`)를 도메인 디렉토리 전체에 Grep — 같은 숫자가 다른 파일에도 나오면 중복 하드코딩 가능성.
3. 실제 계산 로직 파일(`*_service.py`, `calculator.py`)을 열어 다음을 반드시 확인:
   - 이 파일이 원본 pricing 모듈을 **import해서 쓰는지**, 아니면 **자체 `DEFAULT_PRICES` 같은 딕셔너리를 따로 갖고 있는지** (import만으로 안심하지 말 것 — import는 하되 별도 하드코딩 fallback을 추가로 갖고 있는 경우가 실제로 있었다).
   - `self.get_price(code) or <literal>` 같은 인라인 fallback이 코드 곳곳에 있는지 (`or \d+\.\d+` 패턴으로 grep).
   - 가격이 아닌 것처럼 보이지만 실은 $ 단가인 별도 딕셔너리(`STORAGE_SETUP_BY_SIZE`, `SPECIAL_ITEM_COSTS`, `SUPPLEMENT_DEFINITIONS` 류 — 이름에 PRICE/RATE/COST가 없어도 flat_amount, price 키를 가지면 대상)가 있는지.
   - 함수 시그니처의 기본값(`def foo(unit_sf) -> float: return TABLE.get(unit_sf, 85.00)`)에 박힌 fallback literal도 놓치지 말 것.
4. export/PDF/Excel 생성 서비스(`export.py` 등)에 legacy 가격 세트가 별도로 있는지 확인. 다른 프로젝트에서 포팅된 코드일 수 있고 코드 체계가 완전히 다를 수 있다(예: Xactimate 코드 vs `box_small` 같은 자체 키).
5. 발견한 모든 위치를 한 번에 나열해서 사용자에게 "이만큼 발견했다, 전부 반영할까?" 확인한다 — 특히 legacy/거의 죽은 코드처럼 보이는 fallback은 반영 여부를 사용자가 정하게 한다.

범위가 넓으면(파일 4개 이상, 2000줄 넘는 서비스 파일 등) 이 조사를 general-purpose Agent에게 위임해도 된다. 단, "가격 아닌 계수(물량 산정용 multiplier 등)는 제외하고 순수 $ 단가만" 이라고 명시해서 시켜야 한다.

### 3. 웹 리서치
WebSearch로 해당 항목군의 **최근 원가/시장 동향**을 조사한다. 최소한 다음을 확인:
- 원자재/부품 가격 추세 (관세, 원자재 원가 등 — 도메인에 따라 다름)
- 인건비 동향 (해당 지역 — 이 프로젝트는 DMV/Virginia 기준)
- 운송/물류 비용 (연료비, 운임)
- 최종 소비자 가격이 아니라 **원가 압박 방향**이 인상 근거의 핵심 — 예를 들어 특정 카테고리가 시장에서 오히려 하락 중이면(예: 자가창고 임대료) 인상 근거가 약하다는 것도 발견해서 반영해야 한다.

카테고리마다 원가 압박 강도가 다르면 그 차이를 인상률에 반영한다(균일 인상보다 근거가 탄탄함). 검색 결과에 항상 출처(URL)를 남긴다.

### 4. 인상안 확정 — 반드시 사용자 확인
리서치가 끝나면 **AskUserQuestion으로 카테고리별(또는 전체) 인상률 제안을 제시하고 승인을 받는다.** 절대로 리서치만으로 자동 적용하지 않는다.

- 인상률은 **사용자가 다른 범위를 명시하지 않는 한 1%~5% 사이**로 제한한다.
- 근거가 갈리면(원가 압박이 큰 카테고리 vs 약한 카테고리) 차등 인상 옵션을 기본 추천으로 제시하고, 균일 인상을 대안으로 함께 제시한다.
- preview에 실제 코드 값 변경 예시(before → after)를 몇 개 넣어서 사용자가 감을 잡게 한다.

### 5. 적용
승인된 인상률로 2번에서 찾은 **모든 위치**를 일관되게 수정한다.
- 각 파일 상단/딕셔너리 근처에 "왜 이만큼 올렸는지" 짧은 주석을 남긴다(리서치 근거 요약 + 날짜). 코드에 장문 코멘트는 쓰지 않되, 이건 가격 변경 이력이라 예외적으로 근거를 남길 가치가 있다.
- fallback 체인 간 값이 **정확히 동일**해야 한다 — 원본과 fallback이 반올림 등으로 미세하게 달라지면 안 됨.
- 이번 작업과 무관한 기존 버그(예: 존재하지 않는 코드를 참조하는 매핑)를 발견해도 알아서 고치지 말고 사용자에게 별도로 보고만 한다.

### 6. 검증
- 수정한 언어의 문법 체크 (Python이면 `python -c "import ast; ast.parse(...)"` 정도로 충분, 굳이 서버를 띄우지 않는다).
- 구 가격 값이 도메인 전체에 더 이상 남아있지 않은지 최종 Grep.
- 요약 리포트: 리서치 근거 bullet, 카테고리별 인상률 표, 수정된 파일 목록.

## Bathroom / Kitchen Cabinet: 기본 단가와 회사 단가 (2026-11-08부터)

이 두 도메인은 단가가 세 층이다. 이 스킬이 고치는 건 **기본 단가(코드)뿐**이다.

1. **기본 단가** — `pricing.py`의 표. 월/분기 업데이트 대상.
2. **회사 단가** — DB `unit_price_overrides`. 회사가 "회사별 단가" 화면(`/unit-prices`)에서 항목별 material/labor를 직접 넣은 값. 이 스킬은 절대 건드리지 않는다. 회사가 비워둔 쪽(material 또는 labor)만 기본 단가를 따라가므로, 기본 단가를 올리면 그 쪽만 같이 오른다.
3. **견적의 price book** — 견적은 처음 계산할 때 그 시점 단가 전체(기본+회사)로 고정된다(`price_books`, `*_estimates.price_book_id`). 기본 단가를 올려도 **이미 계산된 견적은 바뀌지 않는다**. 견적 화면의 "현재 단가로 다시 계산"을 눌러야 바뀐다. 리포트에 이 점을 적는다.

주의할 것:
- **어떤 숫자가 "가격"인지는 `price_catalog.py`가 정한다.** 거기 등록된 표의 값만 회사가 바꿀 수 있고 price book에 들어간다. 계수(multiplier, share, waste, tax, zip)는 등록돼 있지 않으며 이 스킬로 올리면 안 된다(가격이 아니다).
- **키 이름을 바꾸거나 표 구조를 바꾸지 말 것.** 회사 단가와 price book은 `"DEMO_RATES.floor_tile_per_sf"` 같은 경로로 값을 찾는다. 키를 바꾸면 그 항목의 회사 단가가 조용히 사라진다. 값만 바꾼다.
- 새 가격 표나 새 키를 추가했다면 `price_catalog.py`에도 넣는다(kind: material/labor/mixed, mixed면 share). `tests/test_unit_prices.py`가 기본 split 합이 코드 값과 같은지 검사한다.
- 계산기 안의 숫자 리터럴 fallback(`.get(tier, 900)` 같은)은 여전히 grep 대상이다.

## 알려진 대상 (마지막 업데이트: 2026-11)

파일 경로는 항상 grep으로 재확인할 것 — 아래는 시작점이지 고정된 정답이 아니다.

### Kitchen Cabinet Estimate
- `backend/app/domains/cabinet_estimate/pricing.py` — `BASE_RATES` (Stock/Semi-Custom/Custom × base_lf/wall_lf/tall_each)가 핵심. 그 외 `SCOPE_ITEMS`, `SINK_BY_BASE`(→ `SINK_PRICES`로 파생), 패널/필러/카운터탑 표. 어떤 표가 가격인지는 `cabinet_estimate/price_catalog.py`.
- 가전 detach & reset은 `appliance_labor.py`의 시간 모델(`CREW_RATE`, `XACTIMATE_DR_PUBLISHED` 등)에서 생성되어 `APPLIANCE_RESET_PRICES`가 된다. 가격을 직접 쓰지 말고 시간/공개가를 고친다.
- 인상 로직 예시: 관세/원자재 노출도가 높은 tier(Stock)에 더 높은 인상률, 국내 제작 위주 tier(Custom)에 낮은 인상률.

### Bathroom Estimate
- `backend/app/domains/bathroom_estimate/pricing.py` — 페이즈별 표(`DEMO_RATES`, `PLUMBING_RATES`, `TILE_*`, `VANITY_*`, `DETACH_RESET_COSTS`, `HIDDEN_COSTS` 등)와 단일 상수(`VANITY_INSTALL`, `MIRROR_INSTALL` …). 단일 상수는 계산기가 `FLAT_PRICES["VANITY_INSTALL"]`로 읽는다. 어떤 표가 가격인지는 `bathroom_estimate/price_catalog.py`.
- 파일 상단 docstring에 지난 인상 이력(Tier A/B)이 있다. 이어서 적는다.

### Flooring Estimate
- `backend/app/domains/flooring_estimate/pricing.py` — `FLOORING_MATERIAL`·`FLOORING_INSTALL_LABOR`(자재별, carpet은 SY), `PAD_PRICES`, `REMOVAL_RATES`, `PREP_RATES`, `TRIM_RATES`, `DETACH_RESET_RATES`, `TRANSITION_RATES`, `STAIR_RATES`, `CONTENTS_RATES`, `GENERAL_RATES`. 어떤 표가 가격인지는 `flooring_estimate/price_catalog.py`. `WASTE_PCT`, `PATTERN_LABOR_MULTIPLIER`, `BOX_COVERAGE_SF`, carpet roll 규칙은 가격이 아니다.
- Bathroom과 같은 작업(LVT/SPC, 타일, self-leveling, subfloor, 변기·vanity D&R, MDF base, quarter round, floor protection, dumpster)은 Bathroom 값과 일치시켜 두었다. 한쪽을 올리면 다른 쪽도 같이 볼 것.
- 2026-11-12 첫 리서치 업데이트: Flooring 전용 임시값 28개를 리서치 값으로 재설정(오르고 내린 것 섞임, 사용자 승인). 가전 D&R은 65로 내리고 식기세척기 D&R(`DETACH_RESET_RATES.dishwasher`, 280)을 따로 둠. 근거와 출처는 `pricing.py` 상단 History. 이제부터는 일반 절차대로 1~5% 범위.
- Bathroom 공유 값은 그대로 두었지만 리서치는 다르게 나왔다(LVP 자재 ~4.00, 포세린 ~5.35, 타일 철거 ~4.00, self-leveling ~4.25, subfloor ~6.75, 변기 D&R ~290, vanity D&R ~325, MDF base ~7.50, quarter round ~3.40, dumpster ~550). **다음 Bathroom 업데이트 때 두 도메인 함께 검토할 것.**
- 공개된 Northern Virginia Xactimate 단가표는 없다. 다른 지역 Xactimate 견적(Baltimore MDBA8X 2024, NJ 2021, Houston 2026, Boise 2025)을 Verisk 인건비 상승률로 보정하고, Homewyse ZIP 22030, Floor & Decor/Home Depot 목록, Fairfax dumpster 견적과 함께 봤다.
- 부수 작업 항목(`items.py`)은 가격 경로(`TRIM_RATES.shoe_molding_per_lf` 등)만 참조한다. 키 이름을 바꾸면 견적에 저장된 선택과 회사 단가가 끊기니 절대 바꾸지 말 것.

### Packing Estimate
- `backend/app/domains/pack_calculation/seed_prices.py` — `DEFAULT_PACKING_PRICES` (원본, DB 시딩용).
- `backend/app/domains/pack_calculation/packing_service.py` — **실제 계산 엔진.** 자체 `DEFAULT_PRICES` 딕셔너리를 따로 가지고 있어 seed_prices.py와 반드시 동기화 필요. 그 외 `STORAGE_SETUP_BY_SIZE`, `SPECIAL_ITEM_COSTS`, `SUPPLEMENT_DEFINITIONS`, `select_truck()`/`get_storage_setup_fee()`의 인라인 fallback 리터럴도 전부 이 파일 안에 흩어져 있음.
- `backend/app/domains/pack_calculation/export.py` — legacy PDF/Excel export용 `DEFAULT_PRICES` (다른 프로젝트에서 포팅된 코드, 코드 체계가 Xactimate가 아니라 `box_small`/`truck_26` 같은 자체 키).
- 카테고리 매핑: labor/room/mattress ≈ supplement(조건부 할증), transport, storage, box/protective/specialty, debris — 원가 압박 강도가 카테고리마다 크게 다름(예: storage는 리서치 시점 전국 평균이 하락 중이었음).

새 도메인을 처음 다룰 때는 이 섹션에 위 형식으로 추가해두면 다음 실행이 훨씬 빨라진다.

## 실행 주기

사용자가 한 달에 한 번 정도 이 스킬을 돌리고 싶어한다. 이 스킬 자체는 트리거를 갖지 않는다 — 자동 스케줄이 필요하면 `schedule`(cron) 또는 `/loop` 스킬로 별도 리마인더를 설정하고, 리마인더가 울리면 사용자가 이 스킬을 수동으로 호출하는 흐름을 기본으로 한다. 가격 변경은 항상 사람이 승인한 시점에만 일어나야 한다(4단계 참고) — 무인 자동 적용은 하지 않는다.
