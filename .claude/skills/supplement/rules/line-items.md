# Line item 보충 규칙

bid로 처리하지 않는 방에만 적용한다. 각 규칙의 형식은 다음과 같다.

**조건 → 조치 → 수량 → 확신도**

확신도:
- 높음: 규칙상 필수이고, 수량이 PDF나 스케치로 정해진다.
- 중간: 수량이나 조건 확인이 필요하다.
- 확인: 현장이나 사진을 봐야 판단할 수 있다.

출처는 앱 Cheat Sheet(Supplement 체크리스트와 분야별 섹션)와 사용자 지시다. 2026-11-21 Cardinal Hill로 처음 시험했다.

## Xactimate 입력 방법
- **Bold:** supplement에서 추가하거나 수정한 줄은 모두 **line item description을 bold**로 한다(줄의 # 칸을 클릭하고 Ctrl+B. 줄 전체가 bold가 되고 글자와 숫자는 그대로다). Notes 메모가 아니라 description이다(사용자 2026-11-22). 보험사 원래 줄 중 손대지 않은 줄은 bold로 하지 않는다.
- **보험사 줄의 수량만 고칠 때** (예: PT1의 Seal 15 → 33 SF): 그 줄의 수량을 바꾸고, 항목 목록의 **Notes 칸 아이콘(📄)을 더블클릭**해서 연 메모에 **한 줄로** 무엇을 왜 바꿨는지 쓴다. 예: `Qty revised 15 → 33 SF: patch 15 SF × 2.2 blend area`. 새 줄은 만들지 않는다(사용자 확인 2026-11-22).
- **빠진 항목을 추가할 때:** 검토 표의 방에 새 줄을 넣는다.
- **D&R(activity R)이 없는 항목을 detach & reset 할 때:** R&R(&) 줄로 넣고, 라인 상세(Unit Price 탭 → Replace Price 옆 "i")의 Material 줄 중 **재사용하는 본체 한 줄만** 지운다. 다시 다는 데 드는 소모품(나사, 접착제, 코킹 등)은 남긴다(사용자 2026-11-22: "screw는 빼면 안 된다"). 줄의 Description도 "R&R" 대신 "Detach & reset"으로 바꾼다(예: `Ceiling medallion - Detach & reset`). Notes에 `Detach & reset ... - material removed`라고 한 줄 쓴다(사용자 2026-11-22). 예: 샹들리에 D&R 때 천장 메달리온(`PLA MED`/`FNC PCMED`에는 R이 없음).
- **Labor minimum:** supplement에서 새 줄을 넣어 Xactimate가 자동으로 붙인 labor minimum(예: PLA MED를 넣어 생긴 `PLA MN-A`)은 해제하지 않고 그대로 둔다(사용자 2026-11-22). `/xactimate` 단계에서 PDF에 없는 minimum을 끈 것은 PDF를 그대로 옮기기 위해서였다. 보고할 때 늘어난 금액에 minimum이 포함됐다고 적는다.
- **같은 line item을 여러 줄 써도 된다** (사용자 2026-11-22). 예: 위치가 다른 tape joint 두 줄, 기존 천장 paint 줄과 별도로 tray paint 줄. 이미 있는 항목이라고 합치거나 건너뛰지 않는다.

## 1. 견적서 일관성 검사 (가장 먼저)
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| C1 | 벽에 새 drywall과 seal이 있는데 벽 paint 줄이 없음 | Paint walls 2 coats 추가 | W | 높음 |
| C2 | 같은 재료의 철거 수량과 설치 수량이 다름. 타일과 wood는 단가에 waste가 포함됨 | 사용자에게 확인 | – | 확인 |
| C3 | 새 trim(QR, baseboard)을 설치하는데 seal & paint 줄이 없음 | Seal & paint 추가 | 설치 LF | 높음 |

## 2. Paint / Seal
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| PT1 | drywall 패치 후 Seal/Paint 수량이 패치 SF와 같음 | 수량을 패치 SF × 배수로 수정. 배수: 1~2 SF ×4, 3~5 ×3, 6~10 ×2.5, 11~20 ×2.2, 21~32 ×2, 33~50 ×1.7, 50+ ×1.5. 벽 전체를 칠하면 배수는 적용하지 않음 | 패치 SF × 배수 | 높음 |
| PT2 | 새 drywall 다음 paint가 1 coat | 2 coats로 수정 | 같은 수량 | 중간 |
| PT3 | 천장 paint가 있는데 물 얼룩일 수 있음(위층 누수 등) | Seal stain blocker 추가, 조명 D&R | C, 조명 개수 | 확인 |

## 3. Wood / Laminate 바닥 교체
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| W1 | Nail-down hardwood(pre-finished solid 포함) 설치 | `FCW BARR` 15# felt 추가 | F | 높음 |
| W2 | Floating(LVP, engineered, laminate) 설치 | Underlayment 추가. concrete slab 위면 vapor barrier도 추가 | F | 높음 |
| W3 | wood 바닥 R&R | Baseboard R&R + seal & paint, QR R&R + seal & paint | PF | 중간 |
| W4 | wood 바닥 R&R인데 **바닥 높이가 바뀌거나 casing 아래가 상함** | 같은 높이로 교체하면(예: 3/4" nail-down → 3/4" nail-down) casing은 그대로 두고 아무것도 넣지 않는다. 새 바닥이 **얇아져** casing 아래에 틈이 생기면 casing D&R, **두꺼워지면** undercut, casing 아래가 **물에 상했으면** casing R&R. 바닥 교체만으로 casing D&R을 넣지 않는다(사용자 2026-11-22, Cardinal에서 뺌). 코드: `FNC DORCRS`는 Xactimate에 없고, `FNC DOPRS`는 Door opening trim D&R(EA), `FNC CRS` casing은 LF | 해당 문 | 확인 |
| W5 | 다른 바닥과 이어지는 곳이 있음 | T-molding(같은 높이) 또는 reducer(높이 다름) | 이어진 곳 LF | 확인 |
| W6 | 캐비닛이 있는 바닥 교체 | Toe kick D&R 또는 R&R | 캐비닛 LF | 확인 |
| W7 | 한 방의 hardwood를 교체하는데, 끊김 없이 이어진 옆 방도 hardwood다 | 옆 방은 색을 맞추려고 sanding: `FCW FIN+` Sand, stain & finish(`FCW FIN`은 착색 없는 natural finish), + `FCW FINDS` dustless. 보험사 견적에 없으면 추가한다 | 옆 방 F | 높음 (사용자 규칙 2026-11-22) |
| W8 | 보험사가 sanding(`FCW FIN`)을 줬거나 W7로 sanding을 넣는 방 | sanding으로 맞출지, hardwood R&R로 바꿀지는 **상황마다 다르다**(사용자 2026-11-22). 정해진 조건이 없으니 혼자 정하지 말고 매번 검토 표에 "sanding / R&R?"로 올려 사용자에게 묻는다. 물을 때 참고로 보여줄 것: 기존 바닥이 pre-finished인지(bevel·공장 마감), cupping/crowning, engineered 마감층 두께, 같은 수종·등급을 구할 수 있는지 | 그 방 F | 확인 (매번 사용자 판단) |

## 4. Drywall
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| D1 | 벽 일부만 교체(flood cut) | `DRY PATCHJ` tape joint 추가 | 경계 LF(보통 PF) | 중간 |
| D2 | 기존 벽에 텍스처가 있음 | 텍스처를 맞추는 줄 추가 | 교체 SF | 확인 |

## 5. 견적 전체
- O&P를 15% / 10%(전체 적용)로 바꾼다. 보험사 PDF가 다른 비율이어도 바꾼다.
- Contents 사이즈는 SF로 정한다(≤200 Small, ≤400 Medium, ≤750 Large). 보험사가 더 큰 사이즈를 줬으면 그대로 둔다.
- 보험사 PDF의 mitigation 인보이스 줄(예: USR MISC "... Mitigation Invoice")은 supplement 견적에 넣지 않는다(사용자 2026-11-22, Cardinal Hill). 이미 빠져 있으면 다시 넣지 않는다. 아직 있으면 검토 표에 "삭제"로 올려 승인받고 뺀다.
