# Contents Estimation System Guide

## 개요

사용자의 모호하고 자연스러운 입력을 기반으로 가구 내용물(contents)의 양을 추정하고, 적절한 Xactimate line items와 labor hours를 계산하는 intelligent system입니다.

## 핵심 기능

### 1. **Fuzzy Input Processing**
사용자가 디테일하게 입력하지 않아도 시스템이 유추합니다:

```python
# 실제 사용자 입력 예시
"Medium bookshelves + contents"                           # 일반적
"Extra extra extra large shelves and too much other stuff" # 복잡
"Small dresser with some clothes"                         # 모호
"Office desk full of papers"                              # 불명확
"Kitchen cabinet packed with dishes"                      # 양 표현
"Wardrobe barely used"                                    # 최소량
```

### 2. **Furniture Type Detection**
가구 타입에 따른 적절한 box type 자동 선택:

| Furniture Type | Contents Type | Line Item | Description |
|----------------|---------------|-----------|-------------|
| Bookshelf | books | `CPS BXBK` | Book box (1.25-1.6 cf) - 무거운 아이템용 |
| Dresser | clothes | `CPS BX MED` | Medium box (1.7-3.5 cf) |
| Wardrobe | hanging_clothes | `CPS BXWDR` | Wardrobe box (7-10 cf) |
| Cabinet | dishes | `TMC BXDISH` | Dish-pack with separators |
| Desk | office_supplies | `CPS BX MED` | Medium box |
| Shelf | general | `CPS BX MED` | Medium box |

### 3. **Size Detection**
다양한 크기 표현을 intelligent하게 파싱:

```python
# 크기 표현 예시
"small bookshelf"                    # → small
"medium dresser"                     # → medium
"large cabinet"                      # → large
"extra large shelves"                # → xl
"extra extra large shelves"          # → xl
"extra extra extra large shelves"    # → xl
"xl wardrobe"                        # → xl
"x-large closet"                     # → xl
```

### 4. **Quantity/Fullness Detection**
내용물의 양을 자연어로 표현:

| 표현 | Multiplier | 예시 |
|------|-----------|------|
| empty | 0.0x | "empty dresser" |
| few, little, bit | 0.3-0.4x | "few books" |
| some, half | 0.5x | "some items" |
| mostly | 0.7x | "mostly full" |
| full, stuff, things | 1.0x | "full of stuff" |
| lots, many, bunch | 1.2x | "lots of books" |
| packed, stuffed | 1.2-1.3x | "packed with dishes" |
| too much, tons | 1.4-1.5x | "too much stuff" |

### 5. **Line Item Calculation**
가구 타입 + 크기 + 양 → 정확한 박스 수 + 보조 자재:

```python
# Example: "Medium bookshelf + contents"
{
    'boxes_needed': 3,
    'line_items': {
        'CPS BXBK': 3,        # Book boxes
        'TMC PPB': 0.3,       # Packing paper (0.1 per box)
    },
    'packing_hours': 0.45,    # 9 minutes per box × 3
    'confidence': 0.70
}

# Example: "Extra extra large shelves and too much stuff"
{
    'boxes_needed': 10,
    'line_items': {
        'CPS BX MED': 10,     # Medium boxes
        'CPS BWRAP': 80,      # Bubble wrap (8 per box)
    },
    'packing_hours': 1.67,    # 10 minutes per box × 10
    'confidence': 0.70
}
```

### 6. **Labor Hour Calculation**
가구 자체 packing + contents packing hours 분리 계산:

```python
# Total labor = Furniture labor + Contents labor

# Example: "Medium dresser + contents"
furniture_labor = 0.4h    # Dresser 자체 포장
contents_labor = 0.27h    # Contents 2 boxes × 8 min
total_labor = 0.67h       # Combined
```

## 시스템 아키텍처

### ContentsEstimator Class

```python
from .contents_estimator import ContentsEstimator

# Usage
result = ContentsEstimator.estimate_contents(
    item_name="Medium bookshelves + contents",
    furniture_type="bookshelf"  # Optional - auto-detected if not provided
)

# Returns
{
    'boxes_needed': 3,
    'line_items': {'CPS BXBK': 3, 'TMC PPB': 0.3},
    'packing_hours': 0.45,
    'contents_type': 'books',
    'confidence': 0.70,
    'reasoning': 'bookshelf (medium) with 1.0x contents → 3 CPS BXBK boxes'
}
```

### Integration in service.py

```python
# service.py의 _get_materials_for_item() 메소드에서 자동 호출

if has_contents:
    furniture_type = ContentsEstimator._detect_furniture_type(base_item_name.lower())
    contents_estimate = ContentsEstimator.estimate_contents(
        item_input.item_name,
        furniture_type=furniture_type
    )

    # Add line items
    for line_item, qty in contents_estimate['line_items'].items():
        materials[line_item] = materials.get(line_item, 0) + qty

    # Store packing hours for labor calculation
    item_input._contents_packing_hours = contents_estimate['packing_hours']
```

## Confidence Score

시스템이 추정의 정확도를 평가합니다 (0.3 - 1.0):

| Confidence | 의미 | 예시 |
|-----------|------|------|
| 0.85-1.0 | 매우 높음 | "Small dresser full of clothes" (명확한 정보) |
| 0.70-0.84 | 높음 | "Medium bookshelves + contents" (일반적) |
| 0.50-0.69 | 중간 | "Shelves with stuff" (모호한 용어) |
| 0.30-0.49 | 낮음 | "Things" (매우 모호) |

**Confidence 계산 요소**:
- Furniture type 명시: +0.2
- Size 명시: +0.1
- Quantity 표현: +0.15
- 모호한 용어 ("stuff", "things"): -0.1

## 테스트 케이스

```bash
# Run test cases
cd backend
.venv/Scripts/python.exe app/domains/pack_calculation/contents_estimator.py
```

**기대 결과**:
```
Input: Medium bookshelves + contents
→ bookshelf (medium) with 1.0x contents → 3 CPS BXBK boxes
  Boxes: 3, Hours: 0.45, Confidence: 70%
  Line items: {'CPS BXBK': 3, 'TMC PPB': 0.3}

Input: Extra extra extra large shelves and too much other stuff
→ shelf (xl) with 1.4x contents → 10 CPS BX MED boxes
  Boxes: 10, Hours: 1.67, Confidence: 70%
  Line items: {'CPS BX MED': 10, 'CPS BWRAP': 80}
```

## Xactimate Line Items Reference

### Box Types

| Code | Description | Best For |
|------|-------------|----------|
| `CPS BXBK` | 1.25-1.6 cf book box | Books, records, heavy items |
| `CPS BX MED` | 1.7-3.5 cf medium box | General items, clothes |
| `CPS BX LRG` | 3.3-4.5 cf large box | Light bulky items |
| `CPS BXWDR` | 7-10 cf wardrobe box | Hanging clothes |
| `TMC BXDISH` | 5-5.25 cf dish-pack | Dishes, glassware |
| `TMC BXGL` | 2-4 cf glass-pack | Glasses, delicate items |

### Packing Materials

| Code | Description | Usage |
|------|-------------|-------|
| `CPS BWRAP` | 3/16" bubble wrap 24" wide | Protection (LF) |
| `TMC BW24` | Bubble wrap 24" × 250' roll | Bulk wrapping (LF) |
| `TMC PPB` | Packing paper 24"×36" bundle (625 sheets) | Dishes, fragile items (EA) |
| `CPS PAD` | Furniture pad | Furniture protection (EA) |
| `CPS WRAP` | Stretch wrap | Furniture wrapping (LF) |

## API 사용 예시

### Frontend Request
```typescript
const payload = {
  calculation_name: "Move estimate",
  rooms: [{
    room_name: "Office",
    floor_level: "MAIN_LEVEL",
    items: [{
      item_name: "Medium bookshelves + contents",
      quantity: 1,
      floor_level: "MAIN_LEVEL"
    }]
  }]
};

const result = await packCalculationAPI.calculate(payload);
```

### Backend Response
```json
{
  "xactimate_pack_out_materials": {
    "CPS PAD": 2,
    "CPS WRAP": 1,
    "CPS BXBK": 3,
    "TMC PPB": 0.3
  },
  "xactimate_pack_out_labor": {
    "CPS LAB": 0.75
  },
  "strategies_used": {
    "fuzzy_matches": [{
      "original_name": "Medium bookshelves + contents",
      "matched_key": "bookshelf_small",
      "matched_materials": { "..." },
      "quantity": 1
    }]
  }
}
```

## Future Enhancements

1. **ML-based Estimation**: 사용자 correction 데이터로 학습
2. **Photo Recognition**: 사진으로 contents 양 추정
3. **Historical Data**: 과거 유사 작업 데이터 활용
4. **User Feedback Loop**: 실제 사용 박스 수 피드백

## Troubleshooting

**Q: Contents가 감지되지 않아요**
A: "+ contents", "with contents", "full of" 등의 키워드를 추가하세요.

**Q: 박스 수가 너무 많아요/적어요**
A: Correction Modal을 사용하여 수정하면 다음부터 학습됩니다.

**Q: 특정 가구 타입이 인식 안 돼요**
A: `contents_estimator.py`의 `FURNITURE_CONTENTS_PROFILES`에 추가하세요.
