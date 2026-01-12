# MJ Estimate Backend API

FastAPI 기반 백엔드 API 서버. Domain-Driven Design 아키텍처를 적용한 현대적인 Python 웹 애플리케이션.

## 프로젝트 구조

```
backend/
├── app/
│   ├── core/                    # 핵심 인프라
│   │   ├── config.py           # 환경 설정
│   │   ├── database_factory.py # DB 팩토리 (PostgreSQL/SQLite)
│   │   └── interfaces.py       # 추상화 인터페이스
│   ├── common/                  # 공통 컴포넌트
│   │   └── base_repository.py  # 기본 저장소 패턴
│   ├── domains/                 # 비즈니스 도메인
│   │   ├── auth/               # 인증/인가
│   │   ├── company/            # 회사 관리
│   │   ├── estimate/           # 견적서 관리
│   │   ├── invoice/            # 송장 관리
│   │   ├── work_order/         # 작업 지시서
│   │   ├── water_mitigation/   # 수해복구 작업
│   │   ├── staff/              # 직원 관리
│   │   ├── storage/            # 파일 스토리지
│   │   ├── document_types/     # 문서 유형 관리
│   │   └── integrations/       # 외부 서비스 통합
│   │       ├── companycam/     # CompanyCam 통합
│   │       ├── google_sheets/  # Google Sheets 동기화
│   │       └── slack/          # Slack 알림
│   └── main.py                 # FastAPI 앱 진입점
├── alembic/                     # 데이터베이스 마이그레이션
├── docs/                        # 문서
├── secrets/                     # 인증 키 (gitignore)
├── uploads/                     # 로컬 파일 스토리지
├── requirements.txt             # Python 의존성
├── .env.development            # 개발 환경 설정
└── .env.production             # 프로덕션 환경 설정
```

## 도메인 아키텍처

각 도메인은 일관된 5-파일 패턴을 따릅니다:

```
domains/{domain_name}/
├── models.py      # SQLAlchemy 모델
├── schemas.py     # Pydantic 요청/응답 스키마
├── repository.py  # 데이터 접근 계층
├── service.py     # 비즈니스 로직 계층
└── api.py         # FastAPI 라우트 핸들러
```

## 주요 도메인

### Water Mitigation (수해복구)
수해복구 작업 관리 시스템:
- 작업 현장 관리
- 사진 업로드 및 카테고리 분류
- AI 기반 사진 자동 분류 (Gemini Vision API)
- Scope of Work 생성
- CompanyCam 연동

### Estimate / Invoice
견적서 및 송장 관리:
- 문서 생성/수정/삭제
- PDF 생성 및 이메일 발송
- Excel 내보내기
- 문서 복제

### Work Order
작업 지시서 관리:
- 작업 지시서 CRUD
- 사진/문서 첨부
- PDF 생성

### Storage
파일 스토리지 추상화 계층:
- Local Storage (개발용)
- Google Drive (프로덕션)
- AWS S3 / Azure Blob (확장 가능)

## 설치 및 실행

### 1. 가상환경 설정

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. 환경 설정

개발 환경:
```bash
# .env.development 파일 사용 (기본값)
# Docker PostgreSQL 사용
docker-compose -f docker-compose.dev.yml up -d
```

프로덕션 환경:
```bash
# .env.production 파일 설정 필요
# NeonDB 또는 Supabase PostgreSQL 사용
```

### 4. 데이터베이스 마이그레이션

```bash
# 마이그레이션 실행
alembic upgrade head

# 새 마이그레이션 생성
alembic revision --autogenerate -m "Migration description"
```

### 5. 서버 실행

```bash
# 개발 모드 (hot reload)
python -m uvicorn app.main:app --reload --port 8000

# 또는 run.py 사용
python run.py
```

## 환경 변수

### 필수 설정

```env
# 데이터베이스
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://user:pass@localhost:5433/dbname

# 보안
SECRET_KEY=your-secret-key
```

### 외부 통합 (선택)

```env
# 통합 기능 활성화
ENABLE_INTEGRATIONS=true

# CompanyCam
COMPANYCAM_API_KEY=your-api-key
COMPANYCAM_WEBHOOK_TOKEN=your-webhook-token

# Google Sheets
GOOGLE_API_KEY=your-api-key
GOOGLE_SHEETS_WATER_MITIGATION_ID=spreadsheet-id

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# AI 사진 분류
ENABLE_AI_PHOTO_CLASSIFICATION=true
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash
```

### 파일 스토리지

```env
# 로컬 스토리지 (개발)
STORAGE_PROVIDER=local
STORAGE_BASE_DIR=uploads

# Google Drive (프로덕션)
STORAGE_PROVIDER=gdrive
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
GDRIVE_ROOT_FOLDER_ID=your-folder-id
```

## API 문서

서버 실행 후 접근 가능:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 주요 API 엔드포인트

### Water Mitigation
```
GET    /api/water-mitigation/jobs              # 작업 목록
POST   /api/water-mitigation/jobs              # 작업 생성
GET    /api/water-mitigation/jobs/{id}         # 작업 상세
PUT    /api/water-mitigation/jobs/{id}         # 작업 수정
DELETE /api/water-mitigation/jobs/{id}         # 작업 삭제
POST   /api/water-mitigation/jobs/{id}/photos  # 사진 업로드
POST   /api/water-mitigation/photos/ai-classify     # AI 사진 분류
POST   /api/water-mitigation/photos/{id}/ai-apply   # AI 분류 적용
```

### Estimates / Invoices
```
GET    /api/documents                          # 문서 목록
POST   /api/estimates                          # 견적서 생성
POST   /api/invoices                           # 송장 생성
GET    /api/documents/{id}/pdf                 # PDF 생성
POST   /api/documents/{id}/send                # 이메일 발송
```

### Work Orders
```
GET    /api/work-orders                        # 작업 지시서 목록
POST   /api/work-orders                        # 작업 지시서 생성
GET    /api/work-orders/{id}                   # 작업 지시서 상세
PUT    /api/work-orders/{id}                   # 작업 지시서 수정
```

### Integrations
```
POST   /api/integrations/companycam/webhook    # CompanyCam 웹훅
POST   /api/integrations/google-sheets/sync    # Google Sheets 동기화
GET    /api/integrations/health                # 통합 상태 확인
```

## 기술 스택

- **Framework**: FastAPI 0.104+
- **ORM**: SQLAlchemy 2.0
- **Validation**: Pydantic 2.0
- **Database**: PostgreSQL (Docker/NeonDB/Supabase)
- **Migration**: Alembic
- **Authentication**: JWT
- **AI**: Google Gemini Vision API
- **Storage**: Local / Google Drive / S3 (확장 가능)

## 테스트

```bash
# 테스트 실행
pytest

# 커버리지 포함
pytest --cov=app
```

## 프로덕션 배포

### Render 배포 (권장)

1. `render.yaml` 설정 파일 사용
2. 환경 변수 설정:
   - `DATABASE_URL`: NeonDB 연결 문자열
   - `SECRET_KEY`: 보안 키
   - 기타 통합 설정

### Docker 배포

```bash
docker build -t mj-estimate-backend .
docker run -p 8000:8000 --env-file .env.production mj-estimate-backend
```

## 문서

- [스토리지 빠른 시작](./docs/STORAGE_QUICK_START.md)
- [Google Cloud 설정](./docs/GOOGLE_CLOUD_SETUP.md)
- [API 문서](http://localhost:8000/docs)
