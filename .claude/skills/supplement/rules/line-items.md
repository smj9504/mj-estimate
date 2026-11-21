# Line item 보충 규칙

bid로 처리하지 않는 방에만 적용한다. 각 규칙의 형식은 다음과 같다.

**조건 → 조치 → 수량 → 확신도**

확신도:
- 높음: 규칙상 필수이고, 수량이 PDF나 스케치로 정해진다.
- 중간: 수량이나 조건 확인이 필요하다.
- 확인: 현장이나 사진을 봐야 판단할 수 있다.

출처는 앱 Cheat Sheet(Supplement 체크리스트와 분야별 섹션)와 사용자 지시다. 2026-11-21 Cardinal Hill로 처음 시험했다.

## Xactimate 입력 방법
- **보험사 줄의 수량만 고칠 때** (예: PT1의 Seal 15 → 33 SF): 그 줄의 수량을 바꾸고, note에 **한 줄로** 무엇을 왜 바꿨는지 쓴다. 예: `Qty revised 15 → 33 SF: patch 15 SF × 2.2 blend area`. 새 줄은 만들지 않는다(사용자 확인 2026-11-22).
- **빠진 항목을 추가할 때:** 검토 표의 방에 새 줄을 넣는다.

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
| W4 | wood 바닥 R&R | Door casing D&R `FNC DORCRS`. 문 1개 = 2 EA | 문 수 × 2 | 중간 |
| W5 | 다른 바닥과 이어지는 곳이 있음 | T-molding(같은 높이) 또는 reducer(높이 다름) | 이어진 곳 LF | 확인 |
| W6 | 캐비닛이 있는 바닥 교체 | Toe kick D&R 또는 R&R | 캐비닛 LF | 확인 |

## 4. Drywall
| # | 조건 | 조치 | 수량 | 확신도 |
|---|---|---|---|---|
| D1 | 벽 일부만 교체(flood cut) | `DRY PATCHJ` tape joint 추가 | 경계 LF(보통 PF) | 중간 |
| D2 | 기존 벽에 텍스처가 있음 | 텍스처를 맞추는 줄 추가 | 교체 SF | 확인 |

## 5. 견적 전체
- GCO&P가 들어갔는지 확인한다.
- Contents 사이즈는 SF로 정한다(≤200 Small, ≤400 Medium, ≤750 Large). 보험사가 더 큰 사이즈를 줬으면 그대로 둔다.
