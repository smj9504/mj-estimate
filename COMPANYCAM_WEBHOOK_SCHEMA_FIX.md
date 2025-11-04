# CompanyCam Webhook Schema Validation 오류 수정

## 🐛 문제 상황

**증상:**
- CompanyCam에서 사진 업로드 시 Water Mitigation에 사진이 나타나지 않음
- Webhook은 수신되지만 처리 실패

**진단 결과:**
```
Webhook Events:
- Total: 110
- Processed: 60
- Failed: 18
- Pending: 23

최근 webhook (2025-11-03 17:29:22) 실패:
4 validation errors for PhotoCreatedWebhook
- type: Field required
- photo: Input should be a valid dictionary or instance of CompanyCamPhoto
- project: Input should be a valid dictionary or instance of CompanyCamProject
- user: Input should be a valid dictionary or instance of CompanyCamUser
```

## 🔍 근본 원인

### 1. `type` 필드 누락
`PhotoCreatedWebhook` 스키마에서 `type` 필드가 required인데, 새로운 webhook 형식 파싱 시 이 필드를 추가하지 않음.

```python
# schemas.py
class PhotoCreatedWebhook(BaseModel):
    type: str = Field(..., description="Event type: photo.created")  # Required!
    photo: CompanyCamPhoto
    project: CompanyCamProject
    user: CompanyCamUser
```

### 2. 타입 불일치
`api.py`에서 `PhotoData`, `ProjectData`, `UserData` 객체를 생성했지만, `PhotoCreatedWebhook`은 `CompanyCamPhoto`, `CompanyCamProject`, `CompanyCamUser`를 기대함.

```python
# Before (오류 발생)
webhook_data = PhotoCreatedWebhook(
    photo=PhotoData(...),  # ❌ Wrong type
    project=ProjectData(...),  # ❌ Wrong type
    user=UserData(...)  # ❌ Wrong type
)
```

## ✅ 해결 방법

### backend/app/domains/integrations/api.py

#### 1. Import 추가
```python
from .companycam.schemas import (
    PhotoCreatedWebhook,
    ProjectCreatedWebhook,  # ← Added
    CompanyCamPhotoResponse,
    CompanyCamStatsResponse
)
```

#### 2. Webhook 파싱 로직 수정 (Line 203-255)
새로운 webhook 형식을 올바른 dict 형식으로 변환:

```python
# Build dict format that matches PhotoCreatedWebhook schema
webhook_payload = {
    "type": "photo.created",  # ✅ Add required 'type' field
    "photo": {
        "id": int(photo_data.get("id", 0)),
        "project_id": int(project_data.get("id", 0)),
        "creator_id": int(user_data.get("id", 0)),
        "photo_description": photo_data.get("description"),
        "uris": {
            "original": uris.get("original", ""),
            "large": uris.get("large"),
            "medium": uris.get("medium"),
            "small": uris.get("small"),
            "thumbnail": uris.get("thumbnail")
        },
        "coordinates": photo_data.get("coordinates"),
        "captured_at": photo_data.get("captured_at"),
        "created_at": photo_data.get("created_at"),
        "updated_at": photo_data.get("updated_at", photo_data.get("created_at"))
    },
    "project": {
        "id": int(project_data.get("id", 0)),
        "name": project_data.get("name"),
        "address": project_data.get("address", {}),
        "coordinates": project_data.get("coordinates")
    },
    "user": {
        "id": int(user_data.get("id", 0)),
        "name": user_data.get("name", "Unknown"),
        "email_address": user_data.get("email_address")
    }
}

webhook_data = PhotoCreatedWebhook(**webhook_payload)
```

## 📊 변경 사항 요약

### 수정된 파일:
1. `backend/app/domains/integrations/api.py`
   - `ProjectCreatedWebhook` import 추가
   - `process_photo_created_event` 함수의 webhook 파싱 로직 수정
   - `type` 필드 추가
   - 올바른 dict 형식으로 변환

### 추가된 진단 도구:
1. `docs/COMPANYCAM_WEBHOOK_TROUBLESHOOTING.md` - 상세 문제 진단 가이드
2. `backend/tests/check_companycam_webhook.py` - 자동 진단 스크립트
3. `backend/scripts/quick_check.py` - 빠른 상태 확인 스크립트

## 🧪 테스트 방법

### 1. Backend 서버 재시작
```bash
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 2. 상태 확인
```bash
cd backend
.venv\Scripts\python.exe scripts\quick_check.py
```

### 3. CompanyCam에서 사진 업로드
1. CompanyCam에 프로젝트 생성 (주소 포함)
2. 사진 업로드
3. Water Mitigation에서 사진 확인

### 4. 로그 확인
```bash
# Backend 로그에서 성공 메시지 확인
⚙️ Processing photo.created event (Webhook: ...)
Processing photo.created event for Water Mitigation: photo 123456
✅ Photo webhook processed successfully
```

## 🎯 예상 결과

### Before (수정 전):
- ❌ Webhook 수신 → Validation Error → 실패
- ❌ 사진이 Water Mitigation에 나타나지 않음
- ❌ `webhook_events` 테이블에 "failed" 상태

### After (수정 후):
- ✅ Webhook 수신 → 정상 파싱 → 성공
- ✅ 사진이 자동으로 Water Mitigation에 업로드됨
- ✅ `webhook_events` 테이블에 "processed" 상태
- ✅ `companycam_photos` 테이블에 `water_mitigation_job_id` 연결됨

## 🔄 Pending Webhook 재처리 (선택사항)

현재 23개의 pending webhook이 있습니다. 이들은 다음 방법으로 재처리 가능:

### 방법 1: 자동 (권장)
- 새로운 사진이 업로드되면 자동으로 작동
- 기존 pending webhook은 무시 (새 webhook만 처리)

### 방법 2: 수동 재처리 (필요시)
```python
# backend/scripts/reprocess_pending_webhooks.py
from app.core.database_factory import get_database
from sqlalchemy import text

db = get_database().get_session()

# pending webhook들을 다시 pending 상태로 설정
db.execute(text("""
    UPDATE webhook_events
    SET status = 'pending', error_message = NULL
    WHERE service_name = 'companycam'
      AND status IN ('failed', 'pending')
      AND created_at > NOW() - INTERVAL '24 hours'
"""))

db.commit()
db.close()

print("Pending webhooks reset. Restart backend to reprocess.")
```

## 📝 관련 문서

- `COMPANYCAM_WEBHOOK_FIX.md` - 이전 webhook 수정 이력
- `docs/COMPANYCAM_WEBHOOK_TROUBLESHOOTING.md` - 상세 문제 진단 가이드

## ✅ 체크리스트

- [x] 문제 진단 완료
- [x] 근본 원인 파악
- [x] 코드 수정
- [x] Import 추가
- [x] Lint 오류 수정
- [ ] Backend 서버 재시작
- [ ] 실제 사진 업로드 테스트
- [ ] 로그 확인

---
**수정일**: 2025-11-04  
**이슈**: CompanyCam webhook Pydantic validation error  
**상태**: 수정 완료 (테스트 대기)

