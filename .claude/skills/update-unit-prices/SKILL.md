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

## 알려진 대상 (마지막 업데이트: 2026-08)

파일 경로는 항상 grep으로 재확인할 것 — 아래는 시작점이지 고정된 정답이 아니다.

### Kitchen Cabinet Estimate
- `backend/app/domains/cabinet_estimate/pricing.py` — `BASE_RATES` (Stock/Semi-Custom/Custom × base_lf/wall_lf/tall_each)가 핵심. `calculator.py`가 이 모듈을 import해서 쓰고 별도 하드코딩은 없었음(2026-08 기준, 매번 재확인).
- 인상 로직 예시: 관세/원자재 노출도가 높은 tier(Stock)에 더 높은 인상률, 국내 제작 위주 tier(Custom)에 낮은 인상률.

### Packing Estimate
- `backend/app/domains/pack_calculation/seed_prices.py` — `DEFAULT_PACKING_PRICES` (원본, DB 시딩용).
- `backend/app/domains/pack_calculation/packing_service.py` — **실제 계산 엔진.** 자체 `DEFAULT_PRICES` 딕셔너리를 따로 가지고 있어 seed_prices.py와 반드시 동기화 필요. 그 외 `STORAGE_SETUP_BY_SIZE`, `SPECIAL_ITEM_COSTS`, `SUPPLEMENT_DEFINITIONS`, `select_truck()`/`get_storage_setup_fee()`의 인라인 fallback 리터럴도 전부 이 파일 안에 흩어져 있음.
- `backend/app/domains/pack_calculation/export.py` — legacy PDF/Excel export용 `DEFAULT_PRICES` (다른 프로젝트에서 포팅된 코드, 코드 체계가 Xactimate가 아니라 `box_small`/`truck_26` 같은 자체 키).
- 카테고리 매핑: labor/room/mattress ≈ supplement(조건부 할증), transport, storage, box/protective/specialty, debris — 원가 압박 강도가 카테고리마다 크게 다름(예: storage는 리서치 시점 전국 평균이 하락 중이었음).

새 도메인을 처음 다룰 때는 이 섹션에 위 형식으로 추가해두면 다음 실행이 훨씬 빨라진다.

## 실행 주기

사용자가 한 달에 한 번 정도 이 스킬을 돌리고 싶어한다. 이 스킬 자체는 트리거를 갖지 않는다 — 자동 스케줄이 필요하면 `schedule`(cron) 또는 `/loop` 스킬로 별도 리마인더를 설정하고, 리마인더가 울리면 사용자가 이 스킬을 수동으로 호출하는 흐름을 기본으로 한다. 가격 변경은 항상 사람이 승인한 시점에만 일어나야 한다(4단계 참고) — 무인 자동 적용은 하지 않는다.
