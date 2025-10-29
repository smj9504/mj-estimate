# Material Detection V2 - 업그레이드 가이드

## 🚀 새로운 기능 (V2)

### 추가된 Providers

#### 1. **Custom ViT Provider** 🤖
- Hugging Face Transformers 기반
- 사전 훈련된 Vision Transformer 모델 사용
- 커스텀 모델 fine-tuning 지원
- GPU 가속 지원

#### 2. **Ensemble Provider** 🎯
- 여러 모델 결과 통합
- 3가지 전략: Voting, Consensus, Union
- 가중치 기반 신뢰도 집계
- 더 높은 정확도

---

## 📦 설치

### 1. Python 패키지 설치

```bash
cd backend

# Custom ViT를 사용하려면 (선택사항)
pip install transformers torch pillow

# 또는 requirements.txt에 추가
# transformers>=4.30.0
# torch>=2.0.0
# pillow>=10.0.0
```

**참고:**
- Google Vision은 이미 설치됨 (`google-cloud-vision`)
- Custom ViT는 선택사항 (용량: ~500MB)
- GPU가 있으면 자동으로 사용

### 2. 환경변수 설정

`backend/.env.development` 파일이 자동으로 업데이트되었습니다:

```bash
# Custom ViT Model (Hugging Face Transformers)
CUSTOM_VIT_MODEL_NAME=google/vit-base-patch16-224
# CUSTOM_VIT_MODEL_PATH=./models/construction-materials-vit

# Ensemble Settings
ENSEMBLE_STRATEGY=voting
ENSEMBLE_AGGREGATION=weighted_mean
ENSEMBLE_MIN_PROVIDERS=2
```

---

## 🎮 사용 방법

### Provider 선택

#### Google Vision (기본)
```python
provider = "google_vision"
# - 범용 객체 인식
# - GCS credentials 사용
# - API key 불필요
```

#### Custom ViT (AI 모델)
```python
provider = "custom_vit"
# - Hugging Face 사전 훈련 모델
# - GPU 가속 지원
# - 로컬 실행 (API key 불필요)
# - 분류 모델 (bounding box 없음)
```

#### Ensemble (최고 정확도)
```python
provider = "ensemble"
# - 모든 모델 결합
# - 가중치 기반 투표
# - 최고 신뢰도
```

### API 사용 예제

#### 1. Health Check
```http
GET /api/material-detection/health
```

**응답 예시:**
```json
{
  "status": "healthy",
  "providers": [
    {
      "provider_name": "google_vision",
      "available": true
    },
    {
      "provider_name": "custom_vit",
      "available": true
    },
    {
      "provider_name": "ensemble",
      "available": true
    }
  ]
}
```

#### 2. Custom ViT로 감지
```http
POST /api/material-detection/jobs
Content-Type: application/json

{
  "provider": "custom_vit",
  "confidence_threshold": 0.7,
  "image_ids": ["file_uuid_1", "file_uuid_2"]
}
```

#### 3. Ensemble로 감지 (추천)
```http
POST /api/material-detection/jobs
Content-Type: application/json

{
  "provider": "ensemble",
  "confidence_threshold": 0.7,
  "image_ids": ["file_uuid_1"]
}
```

**Ensemble 결과 예시:**
```json
{
  "materials": [
    {
      "category": "Hardwood Flooring",
      "type": "Oak",
      "confidence": 0.92,
      "providers_agreed": 2,
      "providers_used": ["google_vision", "custom_vit"]
    }
  ],
  "raw_response": {
    "strategy": "voting",
    "providers_used": ["google_vision", "custom_vit"],
    "provider_results": {
      "google_vision": {
        "materials_count": 3,
        "processing_time_ms": 450
      },
      "custom_vit": {
        "materials_count": 2,
        "processing_time_ms": 180
      }
    }
  }
}
```

---

## ⚙️ Provider 비교

| Feature | Google Vision | Custom ViT | Ensemble |
|---------|--------------|------------|----------|
| **속도** | ⚡⚡ 빠름 | ⚡⚡⚡ 매우 빠름 (GPU) | ⚡ 느림 (통합) |
| **정확도** | ⭐⭐⭐ 좋음 | ⭐⭐⭐ 좋음 | ⭐⭐⭐⭐ 매우 좋음 |
| **Bounding Box** | ✅ 지원 | ❌ 미지원 | ✅ 지원 |
| **API Key** | ❌ 불필요 (GCS) | ❌ 불필요 | ❌ 불필요 |
| **설치** | ✅ 완료 | ⚠️ 선택사항 | ✅ 자동 |
| **비용** | 무료 (GCS 사용) | 무료 (로컬) | 무료 |
| **GPU** | ❌ | ✅ 자동 사용 | ✅ |
| **오프라인** | ❌ | ✅ | ⚠️ 부분 |

---

## 🎯 Ensemble 전략

### 1. Voting (기본)
- 모든 provider 결과 결합
- 가중치 기반 신뢰도 계산
- 가장 균형잡힌 결과

**언제 사용:**
- 일반적인 감지 작업
- 최대 recall 필요
- 다양한 재료 감지

**설정:**
```python
options = {
    "strategy": "voting",
    "aggregation": "weighted_mean"
}
```

### 2. Consensus (높은 정확도)
- 여러 provider가 동의한 것만 포함
- False positive 최소화
- 높은 precision

**언제 사용:**
- 정확도가 중요
- False positive 방지
- 신뢰할 수 있는 결과만 필요

**설정:**
```python
options = {
    "strategy": "consensus",
    "min_providers": 2  # 최소 2개 이상 동의
}
```

### 3. Union (최대 Coverage)
- 모든 고유한 재료 포함
- 최대 coverage
- 가능한 모든 재료 감지

**언제 사용:**
- 완전한 재료 목록 필요
- 어떤 재료도 놓치지 않으려 할 때
- 사후 수동 검토 계획

**설정:**
```python
options = {
    "strategy": "union"
}
```

---

## 🔧 Custom ViT 세부 설정

### 사전 훈련 모델 변경

```bash
# .env.development
CUSTOM_VIT_MODEL_NAME=google/vit-base-patch16-224  # 기본
# 또는
# CUSTOM_VIT_MODEL_NAME=facebook/deit-base-patch16-224
# CUSTOM_VIT_MODEL_NAME=microsoft/beit-base-patch16-224
```

### Fine-tuned 커스텀 모델 사용

```bash
# 1. 모델 훈련 (별도 작업)
# 2. 모델 저장
mkdir -p backend/models/construction-materials-vit

# 3. 환경변수 설정
CUSTOM_VIT_MODEL_PATH=./models/construction-materials-vit
```

**커스텀 모델 구조:**
```
backend/models/construction-materials-vit/
├── config.json
├── pytorch_model.bin
├── preprocessor_config.json
└── label_mapping.json  # 재료 라벨 매핑
```

### GPU 설정

```python
# 자동 감지됨
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
```

**GPU 메모리 최적화:**
```bash
# .env.development
ENSEMBLE_MIN_PROVIDERS=1  # GPU 메모리 부족시
```

---

## 📊 성능 최적화

### 1. Provider 선택 가이드

**빠른 응답 필요:**
```python
provider = "custom_vit"  # GPU 있으면 매우 빠름
```

**최고 정확도 필요:**
```python
provider = "ensemble"
options = {"strategy": "consensus", "min_providers": 2}
```

**비용 최소화:**
```python
provider = "custom_vit"  # API 호출 없음, 로컬 실행
```

### 2. 배치 처리

```python
# 여러 이미지 동시 처리
image_ids = ["id1", "id2", "id3", ...]
provider = "ensemble"  # 자동으로 병렬 처리
```

---

## 🚨 Troubleshooting

### Custom ViT 초기화 실패

**문제:**
```
Failed to initialize Custom ViT provider: No module named 'transformers'
```

**해결:**
```bash
pip install transformers torch pillow
```

### Ensemble 사용 불가

**문제:**
```
No providers available for ensemble
```

**원인:**
- 사용 가능한 provider가 2개 미만

**해결:**
1. Google Vision 설정 확인
2. Custom ViT 패키지 설치
3. 최소 2개 provider 필요

### GPU 메모리 부족

**문제:**
```
RuntimeError: CUDA out of memory
```

**해결:**
```bash
# .env.development
CUSTOM_VIT_MODEL_NAME=google/vit-small-patch16-224  # 작은 모델 사용
```

또는

```python
# CPU 사용 강제
import torch
torch.cuda.is_available = lambda: False
```

---

## 🎓 Best Practices

### 1. Provider 조합 추천

**일반 사용:**
```python
providers = ["google_vision", "custom_vit"]
ensemble_strategy = "voting"
```

**높은 정확도:**
```python
providers = ["google_vision", "custom_vit"]
ensemble_strategy = "consensus"
min_providers = 2
```

**빠른 처리:**
```python
provider = "custom_vit"  # GPU 권장
```

### 2. Confidence Threshold 설정

```python
# 보수적 (false positive 최소화)
confidence_threshold = 0.85

# 균형잡힌 (기본)
confidence_threshold = 0.70

# 공격적 (recall 최대화)
confidence_threshold = 0.50
```

### 3. 결과 검증

```python
# Ensemble 결과에서 provider 동의 수 확인
for material in materials:
    if material.get('providers_agreed', 0) >= 2:
        # 높은 신뢰도
        pass
```

---

## 📝 Migration from V1

### 기존 코드 호환성

V1 코드는 그대로 동작합니다:

```python
# V1 - 여전히 작동
provider = "google_vision"
```

### V2 기능 추가

```python
# V2 - 새로운 providers
provider = "custom_vit"  # 또는
provider = "ensemble"
```

### Frontend 업데이트

Frontend는 자동으로 새로운 provider를 감지합니다:
- Provider 선택 드롭다운에 자동 추가
- Health check에서 availability 확인

---

## 🔮 향후 계획

### Phase 1 (완료)
- ✅ Custom ViT Provider
- ✅ Ensemble Provider
- ✅ 환경변수 설정

### Phase 2 (다음 단계)
- ⏳ Individual Material CRUD
- ⏳ Bounding Box 시각화
- ⏳ Bulk Operations
- ⏳ CSV/Excel Export

### Phase 3 (미래)
- 🔮 YOLO/Faster R-CNN Provider
- 🔮 Custom 모델 자동 학습
- 🔮 실시간 스트리밍 감지
- 🔮 모바일 앱 통합

---

## ✅ 체크리스트

설치:
- [x] Google Cloud Vision 설치됨
- [ ] Custom ViT 패키지 설치 (선택)
- [x] 환경변수 설정 업데이트됨

테스트:
- [ ] Google Vision 테스트
- [ ] Custom ViT 테스트 (패키지 설치 후)
- [ ] Ensemble 테스트
- [ ] Voting 전략 테스트
- [ ] Consensus 전략 테스트

---

**축하합니다! Material Detection V2가 준비되었습니다! 🎉**
