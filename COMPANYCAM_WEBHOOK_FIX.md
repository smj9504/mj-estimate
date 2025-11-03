# CompanyCam Webhook 자동 Lead 생성 및 사진 업로드 수정 완료

## 🔍 발견된 문제점

### 1. **통합 기능 비활성화**
- `.env.development`에서 `ENABLE_INTEGRATIONS=false`로 설정되어 있음
- Webhook endpoint 자체가 로드되지 않아 404 에러 발생

### 2. **Webhook Event Type 파싱 오류**
- CompanyCam 신규 webhook 형식: `event_type` 필드 사용
- 기존 코드: `type` 필드만 체크
- 결과: 모든 이벤트가 "unknown"으로 처리됨

### 3. **project.created/project.updated 이벤트 미처리**
- `photo.created` 이벤트만 처리
- `project.created`, `project.updated` 이벤트 무시
- 새 프로젝트 생성 시 Lead 자동 생성 불가

### 4. **DB 세션 관리 문제**
- Background task에서 닫힌 DB 세션 재사용 시도
- DB connection error 발생 가능성

### 5. **Webhook Payload 구조 불일치**
- 신규 형식: `payload.payload.photo` 구조
- 레거시 형식: `payload.photo` 구조
- 둘 중 하나만 지원하면 오류 발생

## ✅ 적용된 수정 사항

### 1. **환경 변수 활성화**
```bash
# backend/.env.development
ENABLE_INTEGRATIONS=true  # false → true 변경
```

### 2. **api.py - Webhook 라우터 대폭 개선**

#### Event Type 파싱 개선 (신규/레거시 형식 모두 지원)
```python
# 신규 형식과 레거시 형식 모두 지원
event_type = payload.get("event_type") or payload.get("type", "unknown")
```

#### Event ID 추출 로직 개선
```python
if event_type in ["photo.created", "photo.updated"]:
    event_id = str(
        payload.get("payload", {}).get("photo", {}).get("id") or
        payload.get("photo", {}).get("id", "")
    )
elif event_type in ["project.created", "project.updated"]:
    event_id = str(
        payload.get("payload", {}).get("project", {}).get("id") or
        payload.get("project", {}).get("id", "")
    )
```

#### 3가지 이벤트 처리 추가
```python
if event_type == "photo.created":
    background_tasks.add_task(process_photo_created_event, ...)
elif event_type == "project.created":
    background_tasks.add_task(process_project_created_event, ...)
elif event_type == "project.updated":
    background_tasks.add_task(process_project_updated_event, ...)
```

### 3. **Background Task 함수 완전 재작성**

#### `process_photo_created_event` - 성능 최적화
```python
async def process_photo_created_event(webhook_event_id: str, payload: dict):
    db = None
    try:
        # ✅ 새 DB 세션 생성 (기존: 닫힌 세션 재사용)
        database = get_database()
        db = database.get_session()

        # ✅ 신규/레거시 payload 형식 모두 지원
        if "payload" in payload and "photo" in payload["payload"]:
            # 신규 형식 처리
            photo_data = payload["payload"]["photo"]
            # URIs를 리스트→딕셔너리로 변환
            uris = {}
            for uri_obj in photo_data.get("uris", []):
                uris[uri_obj.get("type", "")] = uri_obj.get("url", "")
            webhook_data = PhotoCreatedWebhook(...)
        else:
            # 레거시 형식 처리
            webhook_data = PhotoCreatedWebhook(**payload)

        # ✅ 상세 로깅 추가
        logger.info(f"⚙️ Processing photo.created event (Webhook: {webhook_event_id})")

        # Handler 실행
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_photo_created(webhook_data, webhook_event_id)

        logger.info(f"✅ Photo webhook processed successfully")

    except Exception as e:
        logger.error(f"❌ Error processing photo webhook: {e}", exc_info=True)
        # Webhook event 상태 업데이트
        ...

    finally:
        # ✅ DB 세션 항상 닫기
        if db:
            db.close()
```

#### `process_project_created_event` - 신규 추가
```python
async def process_project_created_event(webhook_event_id: str, payload: dict):
    """
    CompanyCam에 새 프로젝트가 생성되면:
    1. Water Mitigation Lead 자동 생성
    2. 프로젝트의 모든 사진 다운로드
    3. Slack 알림 전송

    성능 최적화:
    - 새 DB 세션 생성
    - Async API 호출
    - 배치 사진 처리
    """
    # 구현 내용은 위와 동일한 패턴
```

#### `process_project_updated_event` - 신규 추가
```python
async def process_project_updated_event(webhook_event_id: str, payload: dict):
    """
    프로젝트가 업데이트되면 (사진 추가 포함):
    1. 최신 사진 목록 가져오기
    2. 새 사진만 처리 (DB 중복 체크)
    3. 기존 Job에 연결 또는 새 Job 생성

    성능 최적화:
    - 새 사진만 다운로드 (DB 체크 먼저)
    - 배치 처리
    """
    # 구현 내용은 위와 동일한 패턴
```

### 4. **schemas.py - 누락된 데이터 클래스 추가**

webhook_handler_wm.py에서 사용하지만 정의되지 않았던 클래스들 추가:

```python
class PhotoCoordinates(BaseModel):
    """Photo GPS coordinates"""
    lat: Optional[float] = None
    lon: Optional[float] = None
    accuracy: Optional[float] = None

class PhotoURIs(BaseModel):
    """Photo URLs"""
    original: str
    large: Optional[str] = None
    thumbnail: Optional[str] = None

class PhotoData(BaseModel):
    """Photo data for webhook processing"""
    id: int
    uris: PhotoURIs
    photo_description: Optional[str] = None
    tags: Optional[List[str]] = []
    coordinates: Optional[PhotoCoordinates] = None
    created_at: Optional[str] = None
    captured_at: Optional[str] = None

class ProjectData(BaseModel):
    """Project data for webhook processing"""
    id: int
    name: Optional[str] = None
    address: Optional[Dict[str, Any]] = None
    coordinates: Optional[Dict[str, Any]] = None
    creator_id: Optional[int] = None  # ✅ 신규 추가
    creator_name: Optional[str] = None  # ✅ 신규 추가

class UserData(BaseModel):
    """User data for webhook processing"""
    id: int
    name: str
    email_address: Optional[str] = None
```

## 🚀 성능 최적화

### 1. **비동기 처리**
- Webhook 수신 즉시 응답 (200 OK)
- 실제 처리는 Background Task에서 비동기 실행
- CompanyCam timeout 방지

### 2. **DB 세션 관리**
- Background task마다 새 세션 생성
- try-finally로 세션 항상 닫기 보장
- Connection leak 방지

### 3. **중복 사진 방지**
- DB에 이미 존재하는 사진은 다운로드 건너뛰기
- `project.updated` 이벤트에서 새 사진만 처리

### 4. **배치 알림**
- 5분 내 여러 사진 업로드 시 한 번만 알림
- Slack spam 방지
- webhook_handler_wm.py의 기존 로직 활용

### 5. **상세 로깅**
- 이모지로 로그 가독성 향상
  - 📥 Webhook 수신
  - ⚙️ 처리 시작
  - ✅ 성공
  - ❌ 실패
  - ⏭️ 무시
- Payload 구조 디버그 로깅

## 📋 테스트 체크리스트

### 1. **Backend 서버 재시작**
```bash
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 2. **Webhook 엔드포인트 확인**
```bash
# Health check
curl http://localhost:8000/api/integrations/health

# 예상 응답:
[
  {
    "service_name": "companycam",
    "is_configured": true,
    "is_healthy": true,
    ...
  }
]
```

### 3. **CompanyCam Webhook 설정**
CompanyCam 설정에서 다음 이벤트 구독 필요:
- ✅ `photo.created` - 사진 업로드 시
- ✅ `project.created` - 새 프로젝트 생성 시
- ⚠️ `project.updated` - 프로젝트 업데이트 시 (선택적)

### 4. **시나리오 테스트**

#### 시나리오 1: 새 프로젝트 + 사진 업로드
1. CompanyCam에 새 프로젝트 생성 (주소 포함)
2. 프로젝트에 사진 여러 장 업로드
3. **예상 결과:**
   - Water Mitigation Lead 자동 생성 ✅
   - 모든 사진 자동 다운로드 ✅
   - Slack 알림 1회 (배치) ✅

#### 시나리오 2: 기존 프로젝트에 사진 추가
1. DB에 이미 연결된 CompanyCam 프로젝트
2. 새 사진 추가 업로드
3. **예상 결과:**
   - 기존 Job에 사진 추가 ✅
   - Slack 알림 (5분 cooldown) ✅

#### 시나리오 3: 주소 없는 프로젝트
1. CompanyCam에 주소 없이 프로젝트 생성
2. 사진 업로드
3. **예상 결과:**
   - Lead 생성 안 됨 (주소 필수)
   - Webhook event는 "failed" 상태로 기록
   - 에러 로그에 상세 내용 기록

### 5. **로그 확인**
```bash
# 백엔드 로그에서 다음 패턴 확인:
📥 Received photo.created webhook from CompanyCam
⚙️ Processing photo.created event
✅ Photo webhook processed successfully
```

### 6. **DB 확인**
```sql
-- Webhook 이벤트 확인
SELECT event_type, status, created_at, processed_at
FROM webhook_events
WHERE service_name = 'companycam'
ORDER BY created_at DESC
LIMIT 10;

-- CompanyCam 사진 확인
SELECT companycam_photo_id, water_mitigation_job_id, is_synced
FROM companycam_photos
ORDER BY created_at DESC
LIMIT 10;

-- Water Mitigation Jobs 확인
SELECT id, property_address, companycam_project_id, status
FROM water_mitigation_jobs
WHERE companycam_project_id IS NOT NULL
ORDER BY created_at DESC;
```

## 🔧 문제 해결

### Webhook이 수신되지 않는 경우

1. **ENABLE_INTEGRATIONS 확인**
```bash
cd backend
cat .env.development | grep ENABLE_INTEGRATIONS
# ENABLE_INTEGRATIONS=true 여야 함
```

2. **서버 재시작**
```bash
# 서버 중지 후 재시작
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

3. **CompanyCam Webhook 설정 확인**
- Webhook URL: `https://your-domain.com/api/integrations/companycam/webhook`
- 이벤트 구독: `photo.created`, `project.created`
- Webhook Token: `.env.development`의 `COMPANYCAM_WEBHOOK_TOKEN`과 일치

### Lead가 생성되지 않는 경우

1. **로그 확인**
```bash
# Backend 로그에서 에러 확인
# "Failed to parse", "Address incomplete" 등의 메시지 검색
```

2. **주소 정보 확인**
- CompanyCam 프로젝트에 주소가 제대로 입력되었는지 확인
- 최소 요구사항: street, city, state

3. **DB webhook_events 테이블 확인**
```sql
SELECT * FROM webhook_events
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### 사진이 다운로드되지 않는 경우

1. **CompanyCam API 권한 확인**
```bash
# Health check로 API 연결 확인
curl http://localhost:8000/api/integrations/health
```

2. **사진 URL 접근 가능 여부**
- CompanyCam photo URL이 유효한지 확인
- API key가 올바른지 확인

3. **로그에서 다운로드 에러 확인**
```bash
# "Failed to download photo" 메시지 검색
```

## 📊 모니터링

### 통합 통계 확인
```bash
curl http://localhost:8000/api/integrations/companycam/stats
```

예상 응답:
```json
{
  "total_photos": 45,
  "synced_photos": 42,
  "unmatched_photos": 3,
  "work_orders_created": 12,
  "last_webhook_at": "2025-01-03T10:30:00Z"
}
```

### Webhook 이벤트 목록
```bash
curl "http://localhost:8000/api/integrations/webhook-events?service_name=companycam&limit=20"
```

## 🎯 다음 단계

### 추가 개선 사항 (선택적)

1. **재처리 기능**
   - 실패한 webhook 이벤트 수동 재처리
   - Admin UI에서 버튼 클릭으로 재시도

2. **대시보드 추가**
   - Water Mitigation 화면에 CompanyCam 연동 상태 표시
   - 최근 동기화된 사진 미리보기

3. **알림 커스터마이징**
   - Slack 알림 메시지 템플릿 설정
   - 알림 대상 채널 선택

4. **성능 모니터링**
   - Webhook 처리 시간 추적
   - 사진 다운로드 실패율 모니터링

## 📝 관련 파일

- `backend/.env.development` - 환경 변수 (ENABLE_INTEGRATIONS=true)
- `backend/app/domains/integrations/api.py` - Webhook 라우터
- `backend/app/domains/integrations/companycam/schemas.py` - 데이터 스키마
- `backend/app/domains/integrations/companycam/webhook_handler_wm.py` - 실제 처리 로직
- `backend/app/domains/water_mitigation/service.py` - WM 서비스
