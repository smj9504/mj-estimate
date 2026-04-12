# MJ Estimate

보험 복구(Insurance Restoration) 전문 업체를 위한 견적서 / 송장 / 작업관리 / 수해복구 통합 시스템.

React 18 + TypeScript 프론트엔드, FastAPI 백엔드, PostgreSQL 데이터베이스.

## Quick Start

```bash
# 동시 시작 (Windows)
start_servers.bat

# 또는 수동 시작
# Terminal 1 — Backend
cd backend && .venv\Scripts\activate && uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend && npm start
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |
| PgAdmin (Docker) | http://localhost:8080 |

## Tech Stack

### Backend
- **FastAPI** 0.104 · Python 3.9+ (3.12 recommended)
- **Pydantic** 2.9 · **SQLAlchemy** 2.0 · **Alembic** 1.13
- **PostgreSQL** 13+ (Docker dev / NeonDB prod) · SQLite optional
- **JWT** (python-jose) · **bcrypt** 4.3
- **Google Drive / GCS / Local** — 스토리지 추상화 계층
- **OpenAI** GPT-4 Vision · **Gemini** 1.5 Flash — AI 분석

### Frontend
- **React** 18.3 · **TypeScript** 4.9
- **Ant Design** 5.27 · **Zustand** 5 · **TanStack React Query** 5
- **React Router** 6.26 · **Konva** 8.4 / React-Konva 18.2
- **Recharts** 3.1 · **CRACO** — CRA config override
- Lazy Loading + Code Splitting (50%+ 초기 로드 단축)

### External Integrations (선택적)
- **CompanyCam** — Webhook 기반 사진 동기화
- **Google Sheets** — 양방향 자동 동기화 (5분 주기)
- **Slack** — 실시간 알림
- **Gemini Vision** — 사진 자동 분류
- **OpenAI GPT-4 Vision** — 방 사진 분석 / 아이템 감지

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend (React 18)                     │
│  Dashboard │ Estimates │ Invoices │ Work Orders │ WM     │
│  Pack Calc │ Xactimate Helper │ Plumber Report │ Admin   │
├─────────────────────────────────────────────────────────┤
│            React Query + Zustand (State)                 │
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────────┐
│                   Backend (FastAPI)                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Domain Layer (DDD)                     │ │
│  │  auth · company · estimate · invoice · work_order   │ │
│  │  water_mitigation · pack_calculation · sketch       │ │
│  │  photo_analysis · material_detection · plumber_rpt  │ │
│  │  xactimate · xactimate_helper · crew_upload         │ │
│  │  line_items · payment · receipt · storage · file    │ │
│  │  integrations (companycam · google_sheets · slack)  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │          Repository Layer (Data Access)             │ │
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     PostgreSQL    Google Drive    External APIs
     (NeonDB)     (File Storage)  (CompanyCam, Sheets, Slack)
```

## Project Structure

```
mj-react-app/
├── backend/
│   ├── app/
│   │   ├── core/                    # Config, DB factory, interfaces
│   │   ├── common/                  # Base repository, PDF service
│   │   ├── domains/                 # Business domains (DDD)
│   │   │   ├── auth/                # JWT 인증/인가
│   │   │   ├── company/             # 회사 관리
│   │   │   ├── estimate/            # 견적서
│   │   │   ├── invoice/             # 송장
│   │   │   ├── work_order/          # 작업 지시서
│   │   │   ├── water_mitigation/    # 수해복구 (사진·스케치·PDF·AI분류)
│   │   │   ├── pack_calculation/    # Pack-out 계산
│   │   │   ├── photo_analysis/      # AI 사진 분석
│   │   │   ├── material_detection/  # AI 자재 감지
│   │   │   ├── reconstruction_estimate/ # 복구 견적
│   │   │   ├── sketch/              # 인테리어 스케치
│   │   │   ├── plumber_report/      # Plumber 리포트
│   │   │   ├── xactimate/           # Xactimate 코드 관리
│   │   │   ├── xactimate_helper/    # Xactimate AI 도우미
│   │   │   ├── crew_upload/         # Crew 사진 업로드
│   │   │   ├── line_items/          # 라인 아이템 카탈로그
│   │   │   ├── payment/             # 결제 추적
│   │   │   ├── payment_config/      # 결제 설정
│   │   │   ├── receipt/             # 영수증
│   │   │   ├── pdf_editor/          # PDF 편집기
│   │   │   ├── storage/             # 멀티 스토리지 추상화
│   │   │   ├── file/                # 파일 관리
│   │   │   ├── document/            # 문서 관리
│   │   │   ├── staff/               # 직원 관리
│   │   │   ├── dashboard/           # 대시보드 통계
│   │   │   ├── analytics/           # 분석
│   │   │   ├── admin/               # 관리자
│   │   │   ├── credit/              # 크레딧
│   │   │   ├── insurance_extraction/ # 보험 정보 추출
│   │   │   ├── template/            # 템플릿 관리
│   │   │   └── integrations/        # 외부 통합
│   │   │       ├── companycam/      # CompanyCam webhook
│   │   │       ├── google_sheets/   # Google Sheets 동기화
│   │   │       └── slack/           # Slack 알림
│   │   ├── templates/               # Jinja2 PDF 템플릿
│   │   └── main.py                  # FastAPI 진입점
│   ├── alembic/                     # DB 마이그레이션
│   ├── .env.development             # 개발 환경변수
│   └── .env.production              # 프로덕션 환경변수
│
├── frontend/
│   ├── src/
│   │   ├── components/              # 도메인별 컴포넌트
│   │   │   ├── common/              # 공통 UI
│   │   │   ├── estimate/            # 견적서
│   │   │   ├── invoice/             # 송장
│   │   │   ├── work-order/          # 작업 지시서
│   │   │   ├── water-mitigation/    # 수해복구
│   │   │   │   └── sketch/          # Floor Sketch Editor
│   │   │   │       ├── canvas/      # Konva 렌더러
│   │   │   │       ├── panels/      # 사이드바 패널
│   │   │   │       ├── hooks/       # 커스텀 훅
│   │   │   │       └── utils/       # 계산·기본값
│   │   │   ├── pack-calculation/    # Pack 계산기
│   │   │   ├── xactimate-helper/    # Xactimate 도우미
│   │   │   ├── plumber-report/      # Plumber 리포트
│   │   │   ├── sketch/              # 인테리어 스케치
│   │   │   ├── insurance-extraction/ # 보험 추출
│   │   │   ├── dashboard/           # 대시보드
│   │   │   └── admin/               # 관리자
│   │   ├── pages/                   # 페이지 컴포넌트 (47개)
│   │   ├── services/                # API 통신 계층 (31개)
│   │   ├── types/                   # TypeScript 타입 정의
│   │   ├── contexts/                # React Context
│   │   ├── hooks/                   # 공통 커스텀 훅
│   │   ├── utils/                   # 유틸리티
│   │   ├── config/                  # 프론트엔드 설정
│   │   └── App.tsx                  # 라우팅 + Lazy Loading
│   ├── e2e/                         # Playwright E2E 테스트
│   └── public/                      # 정적 파일
│
├── docs/                            # 프로젝트 문서
├── docker-compose.dev.yml           # 개발용 Docker (PG + Redis + PgAdmin)
├── docker-compose.yml               # 프로덕션 Docker
├── render.yaml                      # Render 배포 설정
├── playwright.config.ts             # E2E 테스트 설정
└── start_servers.bat                # 원클릭 서버 시작 (Windows)
```

## Features

### Estimate & Invoice (견적서 · 송장)
- 견적서/송장 CRUD, 자동 번호 생성
- 라인 아이템 빌더 (세금·할인·그룹핑)
- Insurance 견적서 (Claim, ACV/RCV, Depreciation)
- PDF 생성 (커스텀 Jinja2 템플릿)
- 견적서 → 송장 변환, 복제 기능
- 결제 추적, 영수증 생성

### Work Order (작업 지시서)
- 직원 배정, 상태 추적, 우선순위
- Trade별 비용 계산
- 파일 첨부, 일괄 작업
- 대시보드 통계

### Water Mitigation (수해복구)
- Job 생성 · 상태 추적 · 이력 관리
- 사진 갤러리 (날짜별 정리, 벌크 작업)
- **AI 사진 자동 분류** (Gemini Vision) — 10개 카테고리
- **Scope of Work** — 위치/방 관리, 공식 기반 항목, 잔해 계산
- **Floor Sketch Editor** — Konva 기반 인터랙티브 도면
  - Demolition Zone / Containment / Floor Protection / Content Protection / Equipment 배치
  - 이미지 Import + **Scale Calibration** (reference line으로 px/ft 비율 설정)
  - Undo/Redo, Auto-save, PDF 리포트 생성
- CompanyCam webhook 사진 동기화
- 사진 Trash (soft delete / restore / 자동 삭제 스케줄러)

### Xactimate Helper
- Xactimate 코드 조회 및 AI 기반 Scope 작성 도우미
- ScopeBuilder UI로 방별 항목 구성

### Pack Calculator
- AI 방 사진 분석 (GPT-4 Vision)
- 템플릿 기반 아이템 인벤토리 계산
- 저장 용량 계산, 밀도 보정
- 벌크 텍스트 파싱

### Plumber Report
- AI 기반 Plumber 리포트 생성
- 커스텀 PDF 템플릿

### Admin & Analytics
- 역할 기반 대시보드 (Admin / Manager / Staff)
- API 사용량 모니터링, 시스템 설정
- 사용자 · 자재 · 문서 유형 관리

### External Integrations
- **CompanyCam** — Webhook 사진 동기화 (photo.created/deleted)
- **Google Sheets** — 양방향 자동 동기화, 중복 방지
- **Slack** — 작업 알림
- **Google Drive** — 파일 스토리지 (OAuth 2.0)

## Setup

### Prerequisites
- **Node.js** 16+ · **npm**
- **Python** 3.9+ (3.12 recommended)
- **PostgreSQL** 13+ (or Docker)

### Backend
```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env.development   # 환경변수 설정
alembic upgrade head                  # DB 마이그레이션
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm start          # http://localhost:3000
```

### Docker (개발)
```bash
docker-compose -f docker-compose.dev.yml up -d
# PostgreSQL :5433, PgAdmin :8080, Redis :6379
```

## Environment Variables

### Backend (`backend/.env.development`)
```bash
# Database
DATABASE_URL=postgresql://mjestimate:dev_password_2024@localhost:5433/mjestimate_dev
DATABASE_TYPE=postgresql

# Security
SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Storage
STORAGE_PROVIDER=local              # local | gdrive | gcs
STORAGE_BASE_DIR=uploads

# Google Drive (production)
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
GDRIVE_ROOT_FOLDER_ID=your_folder_id

# Integrations (optional)
ENABLE_INTEGRATIONS=true
COMPANYCAM_API_KEY=your-key
SLACK_WEBHOOK_URL=your-url
GOOGLE_SHEETS_WATER_MITIGATION_ID=your-id

# AI
OPENAI_API_KEY=your-key
GEMINI_API_KEY=your-key
ENABLE_AI_PHOTO_CLASSIFICATION=true
```

### Frontend (`frontend/.env`)
```bash
REACT_APP_API_URL=http://localhost:8000
REACT_APP_ENV=development
```

> **주의**: `.env` 파일은 각 서브프로젝트(backend/, frontend/) 폴더 안에만 위치. Root에 생성 금지.

## Domain Pattern (Backend DDD)

각 도메인은 동일한 5-파일 패턴:
```
domains/{name}/
├── models.py       # SQLAlchemy 모델
├── schemas.py      # Pydantic Request/Response 스키마
├── repository.py   # Data access layer
├── service.py      # Business logic
└── api.py          # FastAPI 라우터
```

`main.py`에서 라우터 등록:
```python
from app.domains.new_domain.api import router as new_domain_router
app.include_router(new_domain_router, prefix="/api/new-domain", tags=["New Domain"])
```

## Adding a New Page (Frontend)

```typescript
// 1. src/App.tsx 상단 — lazy import
const NewPage = lazy(() => import('./pages/NewPage'));

// 2. Router — 반드시 Suspense로 감싸기
{
  path: "/new-page",
  element: (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <NewPage />
        </Suspense>
      </Layout>
    </ProtectedRoute>
  )
}
```

## Database Migrations

```bash
cd backend
alembic revision --autogenerate -m "Add new table"
alembic upgrade head
alembic downgrade -1
```

## Testing

```bash
# Backend
cd backend && pytest
cd backend && pytest --cov=app tests/

# Frontend
cd frontend && npm test

# E2E (Playwright)
npx playwright test
```

## Production Deployment

```
Frontend:  Vercel (Free)
Backend:   Render ($7/month, always-on)
Database:  NeonDB (Free tier, 0.5GB)
Storage:   Google Drive (30GB free)
──────────────────────────────
Total: ~$7/month
```

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Vercel    │ ───> │    Render    │ ───> │   NeonDB     │
│  (Frontend) │      │  (Backend)   │      │ (PostgreSQL) │
│    Free     │      │    $7/mo     │      │     Free     │
└─────────────┘      └──────────────┘      └──────────────┘
                             │
                             ├──> Google Drive (Storage)
                             ├──> Google Sheets (Auto-sync)
                             ├──> CompanyCam (Webhook)
                             └──> Slack (Notifications)
```

배포 상세: [DEPLOYMENT.md](./DEPLOYMENT.md)

## License

Copyright 2024-2025 MJ Estimate. All rights reserved.
