# Integrations Domain

외부 서비스 통합을 관리하는 도메인입니다.

## 📋 개요

이 도메인은 다음 외부 서비스와의 통합을 담당합니다:

- **CompanyCam**: 사진 관리 및 프로젝트 추적
- **Slack**: 알림 및 실시간 업데이트
- **Google Sheets**: 데이터 동기화 (향후 구현)

## 🏗️ 아키텍처

```
integrations/
├── models.py              # 공통 모델 (WebhookEvent, CompanyCamPhoto)
├── schemas.py             # 공통 스키마
├── api.py                 # API 엔드포인트
│
├── companycam/            # CompanyCam 통합
│   ├── client.py          # API 클라이언트
│   ├── webhook_handler.py # Webhook 처리
│   ├── schemas.py         # CompanyCam 스키마
│   └── utils.py           # 주소 매칭 등
│
├── slack/                 # Slack 통합
│   ├── client.py          # Slack 클라이언트
│   ├── templates.py       # 메시지 템플릿
│   └── schemas.py         # Slack 스키마
│
└── google_sheets/         # Google Sheets 통합 (향후)
    └── __init__.py
```

## 🔧 설정

### 1. 환경 변수 설정

`.env.development` 또는 `.env.production` 파일에 다음 설정을 추가하세요:

```bash
# CompanyCam
COMPANYCAM_API_KEY=your_api_key
COMPANYCAM_WEBHOOK_TOKEN=your_webhook_token

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SLACK_CHANNEL=#work-orders

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### 2. CompanyCam Webhook 설정

1. CompanyCam 계정 로그인
2. **Settings → API & Webhooks** 이동
3. **Create Webhook** 클릭
4. Webhook URL 입력: `https://your-domain.com/api/integrations/companycam/webhook`
5. **photo.created** 이벤트 구독
6. Webhook token 저장 (환경 변수에 설정)

### 3. Slack Incoming Webhook 생성

1. Slack 워크스페이스 관리자로 로그인
2. https://api.slack.com/messaging/webhooks 방문
3. **Create your Slack app** 클릭
4. Incoming Webhooks 활성화
5. Webhook URL 복사 (환경 변수에 설정)

## 📸 CompanyCam 통합

### 기능

1. **자동 Work Order 생성**
   - 새로운 주소에 사진이 업로드되면 자동으로 Work Order 생성
   - 프로젝트 정보에서 주소 파싱

2. **주소 매칭**
   - 기존 Work Order와 주소 비교
   - Exact match 및 Fuzzy matching 지원
   - 85% 이상 유사도면 매칭 성공

3. **사진 다운로드 및 저장**
   - CompanyCam에서 사진 다운로드
   - Work Order 파일로 자동 첨부

4. **Slack 알림**
   - 새 Work Order 생성 시 알림
   - 기존 Work Order에 사진 추가 시 알림

### Webhook 이벤트 처리 흐름

```
CompanyCam Photo Upload
        ↓
Webhook Received → Signature Verification
        ↓
Parse Address → Match with Work Orders
        ↓
     Match Found?
    ↙          ↘
  YES           NO
   ↓             ↓
Attach Photo  Create Work Order
   ↓             ↓
   └─────┬───────┘
         ↓
  Download Photo
         ↓
  Send Slack Notification
```

### 주소 매칭 알고리즘

1. **Exact Match**: 전체 주소 완전 일치
2. **Street+City+State Match**: 주요 주소 요소 일치
3. **Fuzzy Match (전체)**: 유사도 ≥85%
4. **Fuzzy Match (부분)**: Street+City 유사도 ≥76.5%

### API 엔드포인트

```
POST   /api/integrations/companycam/webhook      # CompanyCam webhook 수신
GET    /api/integrations/companycam/photos       # CompanyCam 사진 목록
GET    /api/integrations/companycam/stats        # CompanyCam 통계
```

## 💬 Slack 통합

### 알림 유형

1. **Photo Upload Notification**
   - 새 Work Order 생성 또는 사진 추가
   - Work Order 정보 및 사진 미리보기
   - "View Work Order" 버튼

2. **Work Order Created**
   - 새 Work Order 생성 알림
   - 기본 정보 표시

3. **System Alerts**
   - 에러 및 경고 알림
   - 심각도 기반 색상 코딩

### 메시지 템플릿

Slack Block Kit 사용:
- Header: 알림 제목
- Section: 상세 정보 (fields)
- Image: 사진 미리보기
- Actions: 버튼 (View Work Order)
- Context: 타임스탬프

## 🔍 Webhook 이벤트 관리

### 감사 로그

모든 webhook 이벤트는 `webhook_events` 테이블에 기록됩니다:

- 서비스 이름 및 이벤트 타입
- 전체 payload 및 headers
- 처리 상태 (pending, processed, failed, ignored)
- 관련 엔티티 (work_order, etc.)

### API 엔드포인트

```
GET    /api/integrations/webhook-events          # 이벤트 목록
GET    /api/integrations/webhook-events/{id}     # 이벤트 상세
GET    /api/integrations/health                  # 서비스 헬스체크
GET    /api/integrations/stats                   # 통합 통계
```

## 🗄️ 데이터베이스 모델

### WebhookEvent

모든 외부 서비스의 webhook 이벤트 로그

```python
- service_name: str          # companycam, slack, google_sheets
- event_type: str            # photo.created, etc.
- payload: JSON              # 전체 webhook payload
- status: str                # pending, processed, failed, ignored
- related_entity_type: str   # work_order, water_mitigation, etc.
- related_entity_id: UUID    # 관련 엔티티 ID
```

### CompanyCamPhoto

CompanyCam 사진 메타데이터

```python
- companycam_photo_id: str   # CompanyCam photo ID
- companycam_project_id: str # CompanyCam project ID
- work_order_id: UUID        # 연결된 Work Order
- photo_url: str             # 사진 URL
- is_synced: bool            # 다운로드 및 첨부 여부
- project_address: str       # 프로젝트 주소
```

## 🧪 테스트

### 로컬 테스트 (ngrok 사용)

1. ngrok 설치: `npm install -g ngrok`
2. FastAPI 서버 실행: `uvicorn app.main:app --reload`
3. ngrok 터널 생성: `ngrok http 8000`
4. CompanyCam webhook URL에 ngrok URL 설정
5. CompanyCam에서 사진 업로드하여 테스트

### Webhook 서명 검증 테스트

```python
from app.domains.integrations.companycam.client import CompanyCamClient

payload = b'{"type":"photo.created",...}'
signature = "expected_signature"
token = "your_webhook_token"

is_valid = CompanyCamClient.verify_webhook_signature(payload, signature, token)
```

## 📊 모니터링

### Health Check

```bash
GET /api/integrations/health
```

응답:
```json
[
  {
    "service_name": "companycam",
    "is_configured": true,
    "is_healthy": true,
    "last_event": "2025-01-15T10:30:00",
    "event_count_24h": 15
  },
  {
    "service_name": "slack",
    "is_configured": true,
    "is_healthy": true
  }
]
```

### Statistics

```bash
GET /api/integrations/stats
```

서비스별 통계:
- 총 이벤트 수
- 성공/실패/대기 중 이벤트
- 마지막 이벤트 시간

## 🚀 향후 개선사항

1. **Google Sheets 통합**
   - Water Mitigation 데이터 동기화
   - 양방향 데이터 sync
   - Real-time updates

2. **재시도 메커니즘**
   - 실패한 webhook 이벤트 자동 재시도
   - Exponential backoff

3. **배치 처리**
   - 여러 사진 동시 업로드 처리
   - 성능 최적화

4. **알림 설정**
   - 사용자별 알림 선호도
   - 알림 채널 선택 (Slack, Email, SMS)

## 📝 문제 해결

### Webhook이 수신되지 않음

1. Webhook URL 확인 (`https://your-domain.com/api/integrations/companycam/webhook`)
2. 방화벽 설정 확인
3. Webhook event 로그 확인: `GET /api/integrations/webhook-events`

### 주소 매칭 실패

1. CompanyCam 프로젝트에 주소 정보 확인
2. Work Order의 주소 형식 확인
3. 로그에서 매칭 시도 확인 (similarity scores)

### Slack 알림이 오지 않음

1. Webhook URL 유효성 확인
2. Slack health check: `GET /api/integrations/health`
3. 워크스페이스 권한 확인

## 🔐 보안

- **Webhook Signature**: HMAC-SHA1으로 서명 검증
- **API Key**: 환경 변수로 안전하게 관리
- **HTTPS**: 프로덕션에서 반드시 HTTPS 사용
- **Rate Limiting**: (향후 구현) API 호출 제한

## 📖 참고 문서

- [CompanyCam API Documentation](https://docs.companycam.com/)
- [CompanyCam Webhooks](https://docs.companycam.com/docs/webhooks-1)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Slack Block Kit](https://api.slack.com/block-kit)
