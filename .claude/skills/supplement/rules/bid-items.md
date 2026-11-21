# Bid item 규칙

bid로 바꾸는 방에서는 보험사 줄을 **지우지 않는다.** 줄의 수량도 그대로 둔다. 각 줄의 Note에 REVISED만 표시한다(사용자 확인 2026-11-21).

## 욕실 (Bathroom bid)

| # | 조건 | 조치 |
|---|---|---|
| B1 | 욕실에 **shower 타일 또는 욕조 타일**이 있다. 예: "Tile shower", shower curb, tub surround, wall niche | 그 욕실은 bid로 처리한다 |
| B2 | B1에 해당하는 욕실 | 욕실 안의 rebuild 줄 전부에 Note = **REVISED**를 고르고 저장한다. 수량은 그대로 둔다. **Contents - move out then reset**도 rebuild로 보고 포함한다. mitigation 줄은 건드리지 않는다 |
| B3 | B1에 해당하는 욕실 | `Tile (Bid Item)` 줄을 넣고 설명을 **`Bathroom (Bid Item)`**으로 바꾼다. 1 EA @ bid 금액, Note = **BID ITEM** |
| B4 | B3의 줄 | 줄 메모에 **`<bid 견적 만든 회사명> (Estimate #<번호>)`**를 넣고, 그 글자를 선택해 **Ctrl+B**로 굵게 한다 |
| B5 | B1에 해당하는 욕실 | GFI, 배기팬 등은 bid에 포함된다. Xactimate에 따로 넣지 않는다 |

욕실 누수로 다른 방이 상한 경우(예: 아래층 천장)는 욕실 안이 아니므로 bid에 넣지 않는다. 그 방은 line item 규칙으로 처리한다.

## Pack-out / Pack-in (Moving bid)

| # | 조건 | 조치 |
|---|---|---|
| P1 | 클레임에 pack-out/in 견적이 있다(SimpleWorks의 packing bid item) | 해당 방들의 `Contents - move out then reset` 줄에 Note = **REVISED**. 수량은 그대로 둔다 |
| P2 | P1에 해당 | `Moving (Bid Item)` 줄을 1 EA @ pack-out 금액으로 넣는다. Note = **BID ITEM**, 줄 메모에 `<회사명> (Estimate #<번호>)` |

## Xactimate 입력 방법
- **Note 드롭다운:** Quick Entry 오른쪽의 Note 칸이다. 목록은 BID ITEM, REVISED, AGENT PAY, EK, OPEN ITEM, SEE FLOORING. 줄을 선택하고, 이 드롭다운에서 값을 고른 뒤 저장(OK)한다.
- **bid 줄 만들기:**
  1. Search에서 `Tile (Bid Item)`을 찾아 넣는다(Moving은 `Moving (Bid Item)`).
  2. Desc를 `Bathroom (Bid Item)`으로 바꾼다.
  3. Calc는 1, 단위는 EA, 단가는 bid 금액으로 한다.
  4. Note = BID ITEM으로 한다.
- **줄 메모(회사명, Estimate #):** 스크린샷의 Notes 칸 아이콘으로 여는 줄 메모로 이해했다. 글자를 선택하고 Ctrl+B로 굵게 한다. Note 드롭다운과는 다른 칸이다. **처음 쓸 때 사용자에게 확인한다.**

## 아직 확인 안 됨
- 욕실 말고 bid로 가는 분야(캐비닛, 바닥재 등)가 있는지와 그 조건.
