---
name: supplement
description: Use when the user asks to turn an Xactimate estimate that copies the carrier's PDF into a supplement request estimate ("/supplement 6315 Cardinal Hill", "supplement 견적서로 바꿔줘", "빠진 거 추가해줘"). For each room it chooses between replacing the work with a bid item (bathroom with shower/tub tile, pack-out) and adding or fixing line items. It applies the rules in this skill's rules/ folder and the app's Cheat Sheet, shows a review table for approval, then edits the Xactimate X1 project (REVISED / BID ITEM notes, Bathroom or Moving bid items). Run it after /xactimate.
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
2. **bid 견적:** SimpleWorks에서 이 클레임의 bid item을 찾는다(Supplement 화면, 또는 클라이언트 Documents). 찾을 것:
   - 욕실 견적(bathroom estimate), pack-out 견적 등.
   - 각각의 금액, 견적을 만든 회사명, Estimate #.
   - 데이터 구조: `bid_item_estimates`. bathroom, cabinet, packing 등이 각 견적에 연결돼 있다.
3. **bid 견적이 없을 때:** bid가 필요한 방인데 견적이 없으면, 검토 표에 "bid 견적 필요"로 표시하고 계속한다.

## 2. 방별 처리 방식 정하기
`rules/bid-items.md`의 조건을 방마다 확인해서, 각 방을 **bid 대체**와 **line item 보충** 중 하나로 정한다. bid로 정한 방에는 line item 규칙을 적용하지 않는다.

## 3. 검토 표 만들기 (Xactimate를 고치기 전에)
아래 형식으로 표를 만들어 사용자에게 보여주고 승인을 받는다.

| # | 방 | 조치(추가/수정/REVISED/bid) | 항목(코드) | 수량 | 근거 규칙 | 확신도 |

- **확신도:**
  - 높음: 규칙상 필수이고, 수량이 PDF나 스케치로 정해진다.
  - 중간: 수량이나 조건 확인이 필요하다.
  - 확인: 현장이나 사진을 봐야 판단할 수 있다.
- **보험사에 유리하게 빠진 것만 다룬다.** 보험사가 이미 우리에게 유리하게 준 항목(예: Contents를 규칙보다 큰 사이즈로 준 경우)은 건드리지 않고 "건드리지 않은 것"에 따로 적는다.
- **수정 기록:** 사용자가 표를 고치면, 그 이유를 규칙 파일에 반영할지 묻고 반영한다.

## 4. Xactimate에 반영 (승인 후)
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
