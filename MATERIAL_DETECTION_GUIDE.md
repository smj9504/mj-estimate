# Material Detection 기능 테스트 가이드

## ✅ 설치 완료 사항

### 백엔드
- ✅ Google Cloud Vision SDK 설치 완료
- ✅ Material Detection API 구현 완료 (`/api/material-detection`)
- ✅ Google Vision Provider 활성화 (PRIMARY)
- ✅ Roboflow Provider 비활성화 (405 에러)

### 프론트엔드
- ✅ MaterialDetectionPage 구현 완료
- ✅ MaterialDetection 컴포넌트 구현 완료
- ✅ materialDetectionService API 서비스 구현 완료
- ✅ 라우팅 설정 완료 (`/reconstruction-estimate/material-detection`)
- ✅ 네비게이션 메뉴 추가 완료 ("AI Material Detection")

---

## 🚀 시작하기

### 1. 백엔드 서버 시작

```bash
# 방법 1: start_servers.bat 사용 (권장)
cd "c:\My projects\mjestimate\mj-react-app"
start_servers.bat

# 방법 2: 수동 시작
# Terminal 1 - Backend
cd backend
python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm start
```

### 2. 브라우저 접속

```
Frontend: http://localhost:3000
Backend API Docs: http://localhost:8000/docs
```

### 3. Material Detection 페이지 접속

**네비게이션 메뉴:**
```
Reconstruction Estimate → AI Material Detection
```

**또는 직접 URL:**
```
http://localhost:3000/reconstruction-estimate/material-detection
```

---

## 🧪 테스트 방법

### Step 1: Health Check 확인

페이지 로드 시 자동으로 health check 수행:
- ✅ Status: **Healthy**
- ✅ Provider: **google_vision** (Available)

만약 "unavailable" 표시되면:
1. GCS Service Account 파일 확인: `backend/secrets/service-account-key.json`
2. 파일이 없으면 Google Cloud Console에서 생성 필요

### Step 2: 이미지 업로드

**2가지 업로드 방법:**

#### 방법 1: 클릭하여 업로드
1. "Upload Image" 박스 클릭
2. 건축 자재 이미지 선택 (jpg, png, webp)
3. 여러 이미지 선택 가능 (최대 10개)

#### 방법 2: Ctrl+V로 붙여넣기 (추천!)
1. 이미지를 클립보드에 복사 (스크린샷 또는 이미지 파일)
2. 페이지에서 **Ctrl+V** 누르기
3. 자동으로 이미지 업로드됨

### Step 3: Detection 설정

#### Provider 선택
- **google_vision** (현재 유일한 활성 provider)

#### Confidence Threshold 조정
- 슬라이더로 조정 (10% ~ 100%)
- 기본값: **70%**
- 낮을수록 더 많은 재료 감지 (false positive 증가)
- 높을수록 정확한 재료만 감지 (놓치는 재료 증가)

### Step 4: 감지 시작

1. **"Start Material Detection"** 버튼 클릭
2. Job 생성 → Background processing 시작
3. **자동 polling** (2초마다 상태 확인)

### Step 5: 결과 확인

#### Job Status 카드
- **Status**: pending → processing → completed
- **Progress Bar**: 처리 진행률
- **Total Images**: 업로드된 이미지 수
- **Processed Images**: 처리 완료된 이미지 수
- **Materials Found**: 감지된 재료 개수

#### Detected Materials 테이블
감지된 각 재료 정보:
- **Image ID**: 이미지 식별자
- **Material Category**: 재료 카테고리 (예: "Hardwood Flooring", "Wood")
- **Material Type**: 재료 타입 (예: "White Oak")
- **Grade**: 등급 (Google Vision은 제공 안 함)
- **Finish**: 마감재 (Google Vision은 제공 안 함)
- **Confidence**: 신뢰도 점수 (원형 progress bar + 백분율)
- **Reviewed**: 검토 여부

---

## 📊 Google Vision이 감지 가능한 재료 (10종)

```javascript
{
  "wood": "Hardwood Flooring", "Wood",
  "floor": "Flooring",
  "tile": "Tile Flooring", "Tile",
  "carpet": "Carpet",
  "concrete": "Concrete",
  "brick": "Brick",
  "drywall": "Drywall",
  "metal": "Metal",
  "stone": "Stone",
  "glass": "Glass"
}
```

**참고:**
- Google Vision은 **범용 객체 인식** 모델입니다
- 건축 자재 특화가 아니므로 **세부 분류 정확도는 제한적**
- Label detection + Object localization 조합 사용
- Bounding box 제공 (normalized coordinates → pixel 변환)

---

## 🔧 Troubleshooting

### 문제 1: "Material detection service unavailable"

**원인:**
- GCS Service Account credentials 없음

**해결:**
```bash
# 1. Google Cloud Console에서 Service Account 생성
# 2. Vision API 활성화
# 3. JSON key 다운로드
# 4. backend/secrets/ 폴더에 저장

# 파일 경로 확인
ls backend/secrets/service-account-key.json
```

**환경변수 확인:**
```bash
# backend/.env.development
GCS_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
```

### 문제 2: "Provider 'google_vision' not available"

**원인:**
- GoogleVisionProvider 초기화 실패

**해결:**
```bash
# 1. 패키지 설치 확인
pip list | grep google-cloud-vision

# 2. 재설치
pip install google-cloud-vision

# 3. 백엔드 재시작
```

### 문제 3: Upload 실패

**원인:**
- File API 엔드포인트 문제
- Storage provider 설정 오류

**해결:**
```bash
# 1. Storage provider 확인
# backend/.env.development
STORAGE_PROVIDER=gcs  # 또는 local

# 2. Local storage 사용 시
STORAGE_PROVIDER=local
STORAGE_BASE_DIR=uploads

# 3. 백엔드 로그 확인
# 터미널에서 에러 메시지 확인
```

### 문제 4: Detection이 시작되지 않음

**원인:**
- Background task 실행 오류
- Image ID mapping 오류

**해결:**
```bash
# 백엔드 로그 확인
# api.py:68-92 라인에서 image_id 처리 로그 확인

# 업로드된 파일 ID 확인
# response.data.data[0].id가 올바른지 확인
```

---

## 🎯 API 테스트 (Swagger UI)

### 직접 API 테스트: http://localhost:8000/docs

#### 1. Health Check
```http
GET /api/material-detection/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "providers": [
    {
      "provider_name": "google_vision",
      "available": true
    }
  ],
  "timestamp": "2025-10-29T..."
}
```

#### 2. Create Detection Job
```http
POST /api/material-detection/jobs
```

**Request Body:**
```json
{
  "provider": "google_vision",
  "confidence_threshold": 0.7,
  "image_ids": ["<file_id_from_upload>"],
  "job_name": "Test Detection Job"
}
```

**Expected Response:**
```json
{
  "job_id": "uuid-here",
  "status": "pending",
  "message": "Job created successfully with 1 images"
}
```

#### 3. Get Job Status
```http
GET /api/material-detection/jobs/{job_id}
```

**Expected Response:**
```json
{
  "id": "uuid",
  "status": "completed",
  "provider": "google_vision",
  "total_images": 1,
  "processed_images": 1,
  "total_materials_detected": 5,
  "avg_confidence": 0.85,
  "detected_materials": [
    {
      "id": "uuid",
      "material_category": "Hardwood Flooring",
      "material_type": "Wood",
      "confidence_score": 0.92,
      "bounding_box": {
        "x": 100,
        "y": 150,
        "width": 500,
        "height": 400
      }
    }
  ]
}
```

---

## 📝 환경변수 설정 요약

### 필수 설정 (backend/.env.development)

```bash
# Material Detection Feature Toggle
ENABLE_MATERIAL_DETECTION=true

# Google Cloud Storage (Vision API 인증에 사용)
GCS_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json

# Google Vision API (선택사항 - 없으면 GCS credentials 사용)
# GOOGLE_CLOUD_VISION_KEY=./path/to/vision-key.json
```

### 선택적 설정

```bash
# Roboflow (현재 비활성화)
ROBOFLOW_API_KEY=your_api_key

# Material Detection 기본값
MATERIAL_DETECTION_CONFIDENCE_THRESHOLD=0.70
MATERIAL_DETECTION_MAX_IMAGES_PER_JOB=50
```

---

## 🎨 UI 특징

### 실시간 피드백
- ✅ Health status badge (상단 우측)
- ✅ Provider availability indicator
- ✅ Upload progress
- ✅ Job status polling (2초 간격)
- ✅ Progress bar (실시간 업데이트)

### 사용성 개선
- ✅ **Ctrl+V 붙여넣기** 지원 (클립보드 이미지)
- ✅ 이미지 프리뷰 (picture-card layout)
- ✅ Confidence threshold 슬라이더 (실시간 조정)
- ✅ 결과 테이블 정렬/필터링

### 시각적 표시
- ✅ Confidence score: 원형 progress bar (색상 코딩)
  - 🟢 Green: ≥90%
  - 🟠 Orange: 70-89%
  - 🔴 Red: <70%
- ✅ Job status tags (아이콘 + 색상)
- ✅ Provider health badges

---

## 🔄 다음 단계 (향후 개선 사항)

### 1. Roboflow Provider 수정
- 405 에러 원인 파악
- 대체 모델 선택
- 건축 자재 특화 모델 사용

### 2. Custom ViT Provider 추가
- 자체 학습 모델 통합
- 더 정확한 재료 분류

### 3. Ensemble Provider 구현
- 여러 provider 결과 조합
- 정확도 향상

### 4. 개별 Material CRUD 완성
- Material 상세 조회 API
- Material 수정 API (manual review)

### 5. Frontend 기능 추가
- Bounding box 시각화
- Material 이미지 미리보기
- Bulk operations (일괄 승인/거부)
- Export to CSV/Excel

---

## 📖 참고 문서

### Backend API
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Code References
- Backend Service: `backend/app/domains/material_detection/service.py`
- Google Vision Provider: `backend/app/domains/material_detection/providers/google_vision.py`
- API Endpoints: `backend/app/domains/material_detection/api.py`
- Frontend Component: `frontend/src/components/reconstruction-estimate/MaterialDetection.tsx`
- API Service: `frontend/src/services/materialDetectionService.ts`

---

## ✅ 체크리스트

설치 및 설정:
- [x] Google Cloud Vision SDK 설치
- [x] GCS Service Account 설정
- [x] Backend 서버 실행
- [x] Frontend 서버 실행

기능 테스트:
- [ ] Health check 성공 (google_vision available)
- [ ] 이미지 업로드 성공
- [ ] Detection job 생성 성공
- [ ] Job status polling 동작
- [ ] Materials 감지 결과 표시
- [ ] Confidence threshold 조정 테스트
- [ ] Ctrl+V 붙여넣기 테스트

---

**준비 완료! 이제 테스트를 시작하세요! 🚀**
