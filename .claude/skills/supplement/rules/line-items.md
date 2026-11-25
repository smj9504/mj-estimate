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
- **보험사 줄을 고칠 때(수량, 코드, 재질 등)** (예: PT1의 Seal 15 → 33 SF): **REVISED + 새 줄** 방식으로 한다(사용자 2026-11-24, Birkdale. 2026-11-22의 "새 줄은 만들지 않는다"를 대체한다).
  1. 같은 방에 고친 내용(코드, activity, 수량)으로 **새 줄**을 넣고 bold로 한다.
  2. 보험사 원래 줄은 **보험사 PDF의 코드와 수량 그대로** 두고, Note 드롭다운 = **REVISED**를 고른 뒤 OK. REVISED를 고르면 그 줄은 $0이 되고 RCV 칸에 "REVISED"가 표시된다. 그래서 새 줄이 그 금액을 대신한다. 이 줄은 bold로 하지 않는다.
  3. REVISED 줄의 Notes 메모(📄 더블클릭)에 **한 줄로** 무엇을 왜 바꿨는지 쓴다. 예: `Revised: laminate changed to LVP; replaced by new line`.
  - 이미 직접 고쳐 둔 줄이면 코드와 수량을 PDF 값으로 되돌린 뒤 REVISED를 붙인다. 다른 category로 되돌릴 때(FCV → FCW)는 Cat 칸을 triple-click하고 새 Cat을 입력, Tab, Sel ▸ 목록에서 고른 뒤 Act와 Calc를 다시 넣는다.
  - REVISED의 위치와 여는 법은 bid-items.md의 "Note 드롭다운"을 본다.
- **보험사가 충분히 준 것은 고치지 않는다.** 보험사 줄의 수량을 줄이거나 0으로 만드는 수정은 넣지 않는다. 겹치는 줄이 있어도 그대로 두고, 모자란 쪽만 늘리거나 추가한다(사용자 2026-11-23).
- **빠진 항목을 추가할 때:** 검토 표의 방에 새 줄을 넣는다.
- **D&R(activity R)이 없는 항목을 detach & reset 할 때:** R&R(&) 줄로 넣고, 라인 상세(Unit Price 탭 → Replace Price 옆 "i")의 Material 줄 중 **재사용하는 본체 한 줄만** 지운다. 다시 다는 데 드는 소모품(나사, 접착제, 코킹 등)은 남긴다(사용자 2026-11-22: "screw는 빼면 안 된다"). 줄의 Description도 "R&R" 대신 "Detach & reset"으로 바꾼다(예: `Ceiling medallion - Detach & reset`). Notes에 `Detach & reset ... - material removed`라고 한 줄 쓴다(사용자 2026-11-22). 예: 샹들리에 D&R 때 천장 메달리온(`PLA MED`/`FNC PCMED`에는 R이 없음).
- **Labor minimum:** supplement에서 새 줄을 넣어 Xactimate가 자동으로 붙인 labor minimum(예: PLA MED를 넣어 생긴 `PLA MN-A`)은 해제하지 않고 그대로 둔다(사용자 2026-11-22). `/xactimate` 단계에서 PDF에 없는 minimum을 끈 것은 PDF를 그대로 옮기기 위해서였다. 보고할 때 늘어난 금액에 minimum이 포함됐다고 적는다.
- **같은 line item을 여러 줄 써도 된다** (사용자 2026-11-22). 예: 위치가 다른 tape joint 두 줄, 기존 천장 paint 줄과 별도로 tray paint 줄. 이미 있는 항목이라고 합치거나 건너뛰지 않는다.

## 1. 견적서 일관성 검사 (가장 먼저)
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| C1 | 벽에 새 drywall과 seal이 있는데 벽 paint 줄이 없음 | Paint walls 2 coats 추가 | W | 높음 |
| C2 | 같은 재료의 철거 수량과 설치 수량이 다름. 타일과 wood는 단가에 waste가 포함됨 | 사용자에게 확인 | – | 확인 |
| C3 | 새 trim(QR, baseboard)을 설치하는데 seal & paint 줄이 없음 | Seal & paint 추가. baseboard + QR을 같이 설치하면 `PNT BCS1SP`(Seal & paint baseboard w/cap &/or shoe) 한 줄, QR만이면 `PNT SHOE`(Seal & paint base shoe or quarter round). 보험사 seal & paint 줄의 수량이 설치 LF보다 작으면 설치 LF(PF)로 올린다(REVISED + 메모) | 설치 LF | 높음 (사용자 확인 2026-11-24, Birkdale) |

## 2. Paint / Seal
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| PT1 | drywall 패치 후 Seal/Paint 수량이 패치 SF와 같음 | 수량을 패치 SF × 배수로 수정. 배수: 1~2 SF ×4, 3~5 ×3, 6~10 ×2.5, 11~20 ×2.2, 21~32 ×2, 33~50 ×1.7, 50+ ×1.5. 벽 전체를 칠하면 배수는 적용하지 않음 | 패치 SF × 배수 | 높음 |
| PT2 | 새 drywall 다음 paint가 1 coat | 2 coats로 수정 | 같은 수량 | 중간 |
| PT3 | 천장 paint가 있는데 물 얼룩일 수 있음(위층 누수 등) | Seal stain blocker 추가, 조명 D&R | C, 조명 개수 | 확인 |
| PT4 | 방에 paint 줄이 하나라도 있음(벽·천장, baseboard·quarter round 같은 trim seal & paint 포함) | **반드시** paint prep `PNT MASKLF`(Mask and prep for paint - plastic, paper, tape (per LF), +) = PF를 넣는다. 보험사가 이미 준 줄이 있으면 수량만 확인한다 | PF | 높음 (사용자 2026-11-24, Birkdale) |
| PT5 | 방에 **벽(wall)이나 천장(ceiling) paint** 줄이 있음 | **반드시** floor protection `PNT MASKSFP`(Floor protection - heavy paper and tape, +) = F를 넣는다. trim(baseboard, quarter round)만 칠하는 방에는 넣지 않는다 | F | 높음 (사용자 2026-11-24, Birkdale) |

## 3. Wood / Laminate 바닥 교체
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| W1 | Nail-down hardwood(pre-finished solid 포함) 설치 | `FCW BARR` 15# felt(+) 추가 | F | 높음 (사용자 확인 2026-11-24) |
| W2 | Floating(LVP, engineered, laminate) 설치 | Underlayment `FCW UC1/8`(1/8" cork, &) 추가. concrete slab 위면 vapor barrier `FCW BARRV`도 추가 | F | 높음 (사용자 확인 2026-11-24) |
| W3 | hardwood 바닥 R&R | Baseboard `FNC B3` + quarter round `FNC QR`를 전체 교체한다. 줄 나누는 법(Remove/Replace)과 수량은 아래 3-1 T1. seal & paint는 C3 | PF | 높음 (사용자 2026-11-24, 11-25) |
| W3b | LVP 바닥 R&R | **quarter round**는 T1처럼 Remove/Replace로 전체 교체한다. **baseboard**는 R&R하지 않고 T2처럼 demo된 구간만 Replace + 전체 paint | PF | 높음 (사용자 2026-11-24. baseboard demo 구간 처리는 11-25 T2를 LVP에도 적용) |
| W4 | wood 바닥 R&R인데 **바닥 높이가 바뀌거나 casing 아래가 상함** | 같은 높이로 교체하면(예: 3/4" nail-down → 3/4" nail-down) casing은 그대로 두고 아무것도 넣지 않는다. 새 바닥이 **얇아져** casing 아래에 틈이 생기면 casing D&R, **두꺼워지면** undercut, casing 아래가 **물에 상했으면** casing R&R. 바닥 교체만으로 casing D&R을 넣지 않는다(사용자 2026-11-22, Cardinal에서 뺌). 코드: `FNC DORCRS`는 Xactimate에 없고, `FNC DOPRS`는 Door opening trim D&R(EA), `FNC CRS` casing은 LF | 해당 문 | 확인 |
| W5 | 다른 바닥과 이어지는 곳이 있음 | T-molding(같은 높이) 또는 reducer(높이 다름) | 이어진 곳 LF | 확인 |
| W6 | 캐비닛이 있는 바닥 교체 | Toe kick D&R 또는 R&R | 캐비닛 LF | 확인 |
| W7 | 한 방의 hardwood를 교체하는데, 끊김 없이 이어진 옆 방도 hardwood다 | 옆 방은 색을 맞추려고 sanding: `FCW FIN+` Sand, stain & finish(`FCW FIN`은 착색 없는 natural finish), + `FCW FINDS` dustless. 보험사 견적에 없으면 추가한다 | 옆 방 F | 높음 (사용자 규칙 2026-11-22) |
| W8 | 보험사가 sanding(`FCW FIN`)을 줬거나 W7로 sanding을 넣는 방 | sanding으로 맞출지, hardwood R&R로 바꿀지는 **상황마다 다르다**(사용자 2026-11-22). 정해진 조건이 없으니 혼자 정하지 말고 매번 검토 표에 "sanding / R&R?"로 올려 사용자에게 묻는다. 물을 때 참고로 보여줄 것: 기존 바닥이 pre-finished인지(bevel·공장 마감), cupping/crowning, engineered 마감층 두께, 같은 수종·등급을 구할 수 있는지 | 그 방 F | 확인 (매번 사용자 판단) |
| W9 | 보험사가 실제와 다른 바닥재로 값을 매김(예: 실제 LVP·hardwood인데 laminate) | 사용자에게 층별 실제 바닥재를 확인하고, 보험사 줄(Remove/Replace)의 코드를 실제 재질로 바꾼다(REVISED + 메모). 철거 수량이 F보다 작으면 F로 올리고, 설치 수량이 F보다 크면 보험사 수량을 그대로 둔다. WM scope의 재질 표시(Wood/Engineered 등)는 참고만 한다. 코드: LVP `FCV PLK`(Vinyl plank flooring), solid hardwood `FCW AV`(Oak #1 common, 무마감) + `FCW FIN`(Sand & finish, natural) / `FCW AVPF`(pre-finished), engineered floating `FCW LAMTF` | 그 방 F | 확인 (Birkdale 2026-11-23: kitchen 층 LVP, 그 위층 hardwood) |
| W10 | 한 층의 바닥재가 이어져 있다(같은 LVP나 hardwood가 방마다 끊기지 않음) | 피해 방만이 아니라 **그 층의 모든 방**에 바닥 R&R을 넣는다. 보험사 줄이 있는 방은 W9처럼 코드를 바꾸고, 줄이 없는 방은 R&R(&) 한 줄을 F로 새로 넣는다. 무마감 hardwood(`FCW AV`)면 방마다 `FCW FIN`도 F로 넣는다. 타일 욕실처럼 바닥재가 다른 방은 뺀다. 스케치에서 closet을 bedroom에 합쳐 두었으면(subroom) bedroom의 F에 closet이 들어 있으니 closet 줄을 따로 넣지 않는다 | 방마다 F | 확인 (사용자 2026-11-24, Birkdale: Main Level 전체 LVP R&R, Level 2 전체 hardwood R&R, Master Bath 제외) |

## 3-1. Trim (Baseboard, Quarter round)
mitigation 때 baseboard·QR 일부를 이미 뜯은 경우가 많다. 뜯은 LF는 SKILL.md 1단계 3번(WM scope·sketch)에서 방별로 확인한다(사용자 2026-11-25).

| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| T1 | **wood 바닥**(hardwood, engineered 등) R&R → baseboard·QR 전체 교체 | R&R(&) 한 줄 대신 **Remove(-) 줄과 Replace(+) 줄을 따로** 넣는다(baseboard `FNC B3`, QR `FNC QR` 각각). Remove는 이미 demo된 LF를 뺀 값, Replace는 전체. 예: PF 100인 방에서 baseboard·QR 30 LF가 이미 demo됐으면 Remove 70, Replace 100. demo가 없으면 Remove = Replace = PF. seal & paint는 C3(전체 PF) | Remove = PF − demo LF, Replace = PF | 높음 (demo LF를 모르면 중간) |
| T2 | **wood가 아닌 바닥**(tile, carpet, laminate) 교체 | Baseboard·QR R&R은 넣지 않는다. **demo된 LF만 Replace(+)** 하고, **전체 PF를 paint** 한다. paint 코드는 C3와 같다(baseboard+QR이면 `PNT BCS1SP`, baseboard만이면 `PNT B1SP`) | Replace = demo LF, paint = PF | 높음 (demo LF를 모르면 중간) |

- **보험사가 이미 준 줄:** 보험사가 R&R을 PF 전체로 줬으면 줄이지 않고 그대로 둔다(위 "보험사가 충분히 준 것은 고치지 않는다"). Remove/Replace로 나누는 것은 우리가 새로 넣거나 REVISED로 바꾸는 줄에만 한다. 보험사 줄이 모자라면(+만 있음, 수량이 PF보다 작음) REVISED + 새 줄로 T1·T2 형식에 맞춘다.
- **검토 표:** 방마다 demo LF와 그 출처(WM scope 항목 또는 sketch demolition zone)를 같이 적는다. demo LF를 찾지 못했으면 '중간'으로 두고 0으로 계산했다고 적는다.

## 4. Drywall
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| D1 | 벽 일부만 교체(flood cut) | `DRY PATCHJ` tape joint 추가 | 경계 LF(보통 PF) | 중간 |
| D2 | 기존 벽에 텍스처가 있음 | 텍스처를 맞추는 줄 추가 | 교체 SF | 확인 |

## 5. 견적 전체
- **Final cleaning:** 모든 방에 `CLN FCR` Final cleaning - construction - Residential(SF, 수량 F)을 **꼭** 넣는다(사용자 2026-11-25). 보험사 견적에 이미 있으면 그대로 두고, 없는 방에만 추가한다. 코드가 검색되지 않으면 description으로 찾는다. bid로 바꾼 방은 bid 견적에 cleaning이 들어 있는지 보고, 모르면 검토 표에 '확인'으로 올린다.
- O&P를 15% / 10%(전체 적용)로 바꾼다. 보험사 PDF가 다른 비율이어도 바꾼다.
- Contents 사이즈는 SF로 정한다(≤200 Small, ≤400 Medium, ≤750 Large). 보험사가 더 큰 사이즈를 줬으면 그대로 둔다.
- 보험사 PDF의 mitigation 인보이스 줄(예: USR MISC "... Mitigation Invoice")은 supplement 견적에 넣지 않는다(사용자 2026-11-22, Cardinal Hill). 이미 빠져 있으면 다시 넣지 않는다. 아직 있으면 검토 표에 "삭제"로 올려 승인받고 뺀다.
- **water mitigation 줄은 supplement 견적에서 모두 지운다**(사용자 2026-11-24, Birkdale). PDF에서 O&P가 0인 Water Mitigation coverage 줄이다: `WTR` 코드(제습기, 송풍기, tear out, appliance detach, equipment setup/monitoring), mitigation용 haul debris(`DMO PU`), mitigation용 Contents move out. 같은 이름이라도 O&P가 붙은 rebuild 줄(예: Kitchen Contents move out, Refrigerator Reset)은 남긴다. 검토 표에는 "mitigation 줄 삭제"로 한 줄로 올린다.
