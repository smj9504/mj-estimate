---
name: supplement
description: Use when the user asks to turn an Xactimate estimate that copies the carrier's PDF into a supplement request estimate ("/supplement 6315 Cardinal Hill", "supplement 견적서로 바꿔줘", "빠진 거 추가해줘"). For each room it chooses between replacing the work with a bid item (bathroom with shower/tub tile, pack-out) and adding or fixing line items. It applies the rules in this skill's rules/ folder and the app's Cheat Sheet, always stops to get the user's approval of a review table of every addition and change, and only then edits the Xactimate X1 project (REVISED / BID ITEM notes, Bathroom or Moving bid items). Run it after /xactimate.
---

# Supplement 견적서 만들기

순서는 항상 두 단계다.
1. `/xactimate`로 PDF를 그대로 옮긴다.
2. 이 스킬로 빠진 것을 추가하고 고친다.

이 스킬은 2단계다. Xactimate 프로젝트가 아직 PDF와 맞지 않으면, 1단계부터 끝내라고 하고 멈춘다.

인자: 주소 또는 손님 이름.

## 규칙 파일
규칙은 이 파일에 쓰지 않는다. 아래 파일에 있고, 사용자가 새 규칙을 알려주거나 판단을 고쳐주면 **그 파일에 바로 반영한다.**
- `rules/bid-items.md`: 방이나 분야를 bid item으로 바꾸는 조건과 Xactimate 입력 방법(욕실, pack-out).
- `rules/line-items.md`: bid가 아닌 방에서 항목을 추가하거나 고치는 규칙. 견적서 일관성 검사도 여기 있다.
- **앱의 Cheat Sheet:** SimpleWorks `/cheat-sheet` 페이지, API는 `GET /api/cheatsheet/sections`. 분야별 코드, 단위, "자주 빠짐" 표시, Supplement 체크리스트가 있다. 처음 데이터는 `backend/alembic/versions/cs01a2b3c4d5_add_cheatsheet_tables.py`에 있지만, 앱에서 고쳤을 수 있으니 가능하면 페이지나 API를 본다.

## 1. 자료 모으기
1. **견적 내용:** `/xactimate` 때 쓴 노트(`<주소>-plan.md`)가 있으면 읽는다. 방별 치수(C/F/W/PF/PC), line item, 문과 창문이 들어 있다. 노트가 없으면 PDF를 다시 읽는다.
2. **bid 견적:** SimpleWorks에서 이 클레임의 bid item을 찾는다(Supplement 화면, 또는 클라이언트 Documents). API로는 `GET /api/supplements/{id}/bid-items`, `GET /api/bathroom-estimates?claim_id=...`로 본다. 찾을 것:
   - 욕실 견적(bathroom estimate), pack-out 견적 등.
   - 각각의 금액, 견적을 만든 회사명, Estimate #.
   - 데이터 구조: `bid_item_estimates`. bathroom, cabinet, packing 등이 각 견적에 연결돼 있다.
3. **철거(demo)된 부분:** 무엇을 어디서 뜯었는지 모르면, 이 클레임 water mitigation job의 sketch나 scope를 본다(사용자 지시 2026-11-22). supplement 응답의 `wm_jobs[].id`가 job id다. 백엔드는 `https://mjestimate-backend.onrender.com`이고, 로그인한 SimpleWorks 탭에서 `localStorage.auth_token`을 Bearer로 붙여 읽는다.
   - **Scope:** `GET /api/water-mitigation/scope/jobs/{job_id}/locations`, 그다음 `/api/water-mitigation/scope/locations/{id}/items`. 층별로 철거 항목과 수량이 나온다(예: Ceiling 139.78 SF, Recessed Light Detach 2 EA).
   - **Sketch:** `GET /api/water-mitigation/sketch/jobs/{job_id}/floors`, 그다음 `/api/water-mitigation/sketch/floors/{id}`. `demolition_zones`에 재료, 면(ceiling/wall/floor), 가로세로 치수가 있다. tape joint 경계 길이 같은 수량 계산에 쓴다.
   - mitigation 때 detach만 하고 끝난 항목(조명, 가구 등)은 rebuild에서 reset이 필요한지 확인한다.
4. **bid 견적이 없을 때:** bid가 필요한 방인데 견적이 없으면, 검토 표에 "bid 견적 필요"로 표시하고 계속한다.

## 2. 방별 처리 방식 정하기
`rules/bid-items.md`의 조건을 방마다 확인해서, 각 방을 **bid 대체**와 **line item 보충** 중 하나로 정한다. bid로 정한 방에는 line item 규칙을 적용하지 않는다.

## 3. 검토 표 만들고 사용자 확인 받기 (필수, 건너뛰지 않음)
**사용자가 승인하기 전에는 Xactimate를 절대 수정하지 않는다.** 1~3단계에서는 PDF, 노트, SimpleWorks만 읽는다. Xactimate는 열어서 보기만 할 수 있다. 사용자가 "중간에 묻지 말라"고 해도 이 확인 단계는 생략하지 않는다(사용자 지시 2026-11-22).

아래 형식으로 Xactimate에서 바꿀 **모든 변경**을 표로 보여준다. 들어가는 것:
- 추가할 줄.
- 수량을 고칠 줄.
- REVISED로 표시할 줄.
- 넣을 bid 줄(금액, 회사명, Estimate #).
- O&P 변경(기존 → 15/10).

| # | 방 | 조치(추가/수정/REVISED/bid/O&P) | 항목(코드) | 수량(기존 → 변경) | 근거 규칙 | 확신도 |

그다음 멈추고 사용자의 답을 기다린다.
- **승인 범위:** 사용자가 승인한 줄만 반영한다. "1~5번만", "8번 빼고"처럼 일부만 승인하면 그 범위만 반영한다.
- **고친 경우:** 사용자가 표를 고치면 고친 표를 다시 보여주고 다시 승인을 받는다.
- **확신도 '확인' 줄:** 사용자가 따로 답하지 않으면 넣지 않는다.

- **확신도:**
  - 높음: 규칙상 필수이고, 수량이 PDF나 스케치로 정해진다.
  - 중간: 수량이나 조건 확인이 필요하다.
  - 확인: 현장이나 사진을 봐야 판단할 수 있다.
- **보험사에 유리하게 빠진 것만 다룬다.** 보험사가 이미 우리에게 유리하게 준 항목(예: Contents를 규칙보다 큰 사이즈로 준 경우)은 건드리지 않고 "건드리지 않은 것"에 따로 적는다.
- **수정 기록:** 사용자가 표를 고치면, 그 이유를 규칙 파일에 반영할지 묻고 반영한다.

## 4. Xactimate에 반영 (승인된 줄만)
- **범위:** 3단계에서 승인된 변경만 한다. 작업 중에 새로 필요한 변경을 발견하면, 하지 말고 멈춰서 따로 확인받는다.
- **작업 방법:** Computer use로 진행하고, 방법은 메모리 `xactimate-x1-sketch-howto`를 따른다. Xactimate는 한 세션만 조작한다.
- **O&P:** Parameters → Overhead and Profit을 **Overhead 15%, Profit 10%**, 전체 적용으로 바꾼다. `/xactimate` 단계에서는 PDF의 O&P를 그대로 두었다.
- **입력 규칙:** REVISED, BID ITEM, bid 줄 만들기는 `rules/bid-items.md`의 "Xactimate 입력 방법"을 따른다. 수량 수정과 항목 추가는 `rules/line-items.md`의 "Xactimate 입력 방법"을 따른다. 수량만 고칠 때는 수량을 바꾸고 note에 한 줄로 이유를 쓴다.
- **줄 추가:** 새 줄은 검토 표의 방에, 코드, activity, 수량 그대로 넣는다. 수량은 가능하면 Calc 공식(F, W, PF 등)으로 넣는다.
- **저장 확인:** 바꿀 때마다 "Saved"가 표시되는지 확인한다.

## 5. 보고
- 레벨별, 방별 스크린샷을 보낸다.
- 한국어로 보고한다:
  - 방별로 바꾼 것(REVISED한 줄, 넣은 bid, 추가한 항목).
  - 적용한 규칙.
  - 확인이 필요한 항목.
  - 합계 변화(보험사 원래 금액 → 지금).
