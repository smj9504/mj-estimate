# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

React + TypeScript + FastAPI 기반 현대적 견적서/송장 관리 시스템

## ⚠️ 프로젝트 구조 규칙 (MUST FOLLOW)

### 환경변수 파일 (.env)
```
✅ CORRECT Structure:
mj-react-app/
├── backend/
│   ├── .env.development         # Backend 개발 환경
│   ├── .env.production          # Backend 프로덕션 환경
│   └── .env.production.example  # Backend 프로덕션 템플릿
└── frontend/
    ├── .env                     # Frontend 개발 환경
    └── .env.production          # Frontend 프로덕션 환경

❌ NEVER create .env files in project root
❌ NEVER duplicate .env files across directories
```

### 가상환경 (Virtual Environment)
```
✅ CORRECT Structure:
mj-react-app/
└── backend/
    └── .venv/                   # Backend Python 가상환경 (ONLY HERE)

❌ NEVER create venv/ or .venv/ in project root
❌ NEVER create multiple venv directories (backend/venv, backend/.venv)
❌ Backend uses .venv/ (with dot prefix) ONLY
```

### 규칙 요약
1. **환경변수**: 각 서브프로젝트(backend, frontend) 폴더 안에만 위치
2. **가상환경**: backend/.venv/ 단일 위치만 사용
3. **절대 금지**: Root 레벨에 venv 또는 .env 파일 생성

## 프로젝트 개요

MJ React App은 React 18 + TypeScript 프론트엔드와 FastAPI 백엔드를 사용하는 현대적인 견적서/송장 관리 시스템입니다. Domain-Driven Design 아키텍처를 기반으로 하며, Ant Design UI 라이브러리를 사용합니다.

## Development Commands

### Quick Start
```bash
# Start both servers (Windows)
start_servers.bat

# Manual start - Backend (Terminal 1)
cd backend && python -m uvicorn app.main:app --reload --port 8000

# Manual start - Frontend (Terminal 2)
cd frontend && npm start
```

### Setup and Dependencies
```bash
# Install backend dependencies
cd backend && pip install -r requirements.txt

# Install frontend dependencies
cd frontend && npm install

# Start development database (optional)
docker-compose -f docker-compose.dev.yml up -d
```

### Build Commands
```bash
# Frontend production build
cd frontend && npm run build

# Frontend development build
cd frontend && npm run build:dev

# Frontend with environment
cd frontend && npm run start:dev    # uses .env.development
cd frontend && npm run start:prod   # uses .env.production
```

### Testing
```bash
# Frontend tests
cd frontend && npm test

# Backend tests (pytest available in requirements.txt)
cd backend && pytest
```

## 아키텍처

### 시스템 아키텍처 개요

```
┌─────────────────┐     ┌─────────────────────────────────────┐
│   Frontend      │────▶│   Backend (FastAPI)                 │
│   (React)       │     │   - Business Logic                  │
│   Port 3000     │     │   - Data Management                 │
└─────────────────┘     │   - External Integrations (선택적)  │
                        │     ├─ CompanyCam                   │
                        │     ├─ Google Sheets                │
                        │     └─ Slack                        │
                        └─────────────────────────────────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                   CompanyCam     Google Sheets     Slack
                      API             API            API
```

**통합 아키텍처 (Integrated Architecture):**
- **Frontend**: React 기반 사용자 인터페이스 (port 3000)
- **Backend**: 비즈니스 로직 + 외부 통합 관리 (port 8000)

**통합 모듈 설계:**
- **논리적 분리**: `domains/integrations/` 디렉토리로 격리
- **선택적 활성화**: `ENABLE_INTEGRATIONS` 환경 변수로 제어
- **독립적 에러 핸들링**: 통합 실패가 메인 앱에 영향 없음
- **향후 확장 가능**: 필요시 별도 서비스로 쉽게 분리 가능

### 백엔드 (FastAPI) - `backend/app/`

#### Domain-Driven Design 구조
```
backend/app/
├── core/                    # 핵심 인프라
│   ├── database_factory.py  # 데이터베이스 팩토리 (PostgreSQL/SQLite/Supabase)
│   ├── config.py            # 환경 설정 (ENABLE_INTEGRATIONS 포함)
│   └── interfaces.py        # 추상화 인터페이스
├── common/                  # 공통 컴포넌트
│   └── base_repository.py   # 기본 저장소 패턴
├── domains/                 # 비즈니스 도메인
│   ├── auth/               # 인증/인가
│   ├── company/            # 회사 관리
│   ├── invoice/            # 송장 관리
│   ├── estimate/           # 견적서 관리
│   ├── work_order/         # 작업 지시서
│   ├── water_mitigation/   # 수해복구 작업
│   ├── integrations/       # 외부 서비스 통합 (선택적)
│   │   ├── companycam/    # CompanyCam 통합
│   │   ├── google_sheets/ # Google Sheets 통합
│   │   └── slack/         # Slack 통합
│   └── staff/              # 직원 관리
└── main.py                 # FastAPI 앱 진입점
```

### External Integrations (선택적 기능)

#### 통합 모듈 구조
```
backend/app/domains/integrations/
├── companycam/              # CompanyCam 통합
│   ├── client.py           # CompanyCam API 클라이언트
│   ├── webhook_handler_wm.py  # Water Mitigation 웹훅 처리
│   ├── schemas.py          # 데이터 스키마
│   └── utils.py            # 유틸리티 함수
├── google_sheets/          # Google Sheets 통합
│   ├── client.py           # Google Sheets API
│   ├── sync_service.py     # 동기화 서비스
│   ├── scheduler.py        # 자동 동기화 스케줄러
│   └── api.py              # API 엔드포인트
├── slack/                  # Slack 통합
│   ├── client.py           # Slack API 클라이언트
│   └── templates.py        # 메시지 템플릿
├── api.py                  # 통합 API 라우터
├── models.py               # 웹훅 이벤트 모델
└── schemas.py              # 공통 스키마
```

#### 통합 기능 관리
- **Feature Toggle**: `ENABLE_INTEGRATIONS=true/false` 환경 변수로 제어
- **조건부 로딩**: 통합 비활성화 시 관련 라우터와 서비스 로드 안 함
- **독립적 에러**: 통합 실패가 메인 앱 동작에 영향 없음
- **Webhook 처리**: CompanyCam, Slack 등 외부 서비스 webhook 수신
- **자동 동기화**: Google Sheets 양방향 동기화
- **알림 전송**: Slack 알림 발송

#### 도메인 패턴 (각 도메인별 동일 구조)
- `api.py` - REST API 엔드포인트
- `service.py` - 비즈니스 로직
- `repository.py` - 데이터 접근 계층
- `models.py` - 데이터베이스 모델
- `schemas.py` - Pydantic 스키마 (Request/Response)

### 프론트엔드 (React) - `frontend/src/`

#### React 아키텍처
```
frontend/src/
├── components/             # 재사용 가능한 컴포넌트
│   ├── common/            # 공통 컴포넌트
│   ├── estimate/          # 견적서 관련 컴포넌트
│   ├── invoice/           # 송장 관련 컴포넌트
│   └── work-order/        # 작업 지시서 컴포넌트
├── pages/                 # 페이지 컴포넌트
│   ├── Dashboard.tsx      # 대시보드
│   ├── DocumentList.tsx   # 문서 목록
│   └── ...
├── services/              # API 통신
├── contexts/              # React Context
├── types/                 # TypeScript 타입 정의
├── utils/                 # 유틸리티 함수
└── App.tsx               # 메인 앱 컴포넌트
```

## 주요 기술 스택

### 백엔드
- **FastAPI** - 현대적 Python 웹 프레임워크
- **Pydantic** - 데이터 검증 및 스키마
- **PostgreSQL** - 데이터베이스 (Docker 또는 Supabase)
- **SQLAlchemy** - ORM 및 데이터베이스 추상화
- **JWT** - 인증/인가
- **Uvicorn** - ASGI 서버

### 프론트엔드
- **React 18** - 사용자 인터페이스
- **TypeScript** - 타입 안전성
- **Ant Design 5.x** - UI 컴포넌트 라이브러리
- **Zustand** - 클라이언트 상태 관리
- **React Query** - 서버 상태 관리
- **React Router v7** - 라우팅
- **CRACO** - Create React App 설정 오버라이드

## 개발 가이드

### 새로운 도메인 추가 (백엔드)
1. `backend/app/domains/` 에 새 도메인 디렉토리 생성
2. 도메인 패턴에 따라 파일 생성:
   - `models.py` - 데이터베이스 모델
   - `schemas.py` - API 스키마
   - `repository.py` - 데이터 접근
   - `service.py` - 비즈니스 로직
   - `api.py` - REST API
3. `main.py`에 라우터 등록

### 새로운 페이지/컴포넌트 추가 (프론트엔드)
1. `frontend/src/pages/` 또는 `frontend/src/components/`에 컴포넌트 생성
2. 필요한 타입 정의를 `frontend/src/types/`에 추가
3. API 통신이 필요하면 `frontend/src/services/`에 서비스 함수 추가
4. 라우팅이 필요하면 `App.tsx`에 경로 추가

## Important URLs & Services

### Application Servers
- **프론트엔드**: http://localhost:3000
- **백엔드 API**: http://localhost:8000
- **백엔드 API 문서 (Swagger)**: http://localhost:8000/docs
- **백엔드 API 문서 (ReDoc)**: http://localhost:8000/redoc

### Infrastructure Services
- **PgAdmin (when using Docker)**: http://localhost:8080
- **PostgreSQL (Docker)**: localhost:5433
- **Redis (Docker)**: localhost:6379

### Integration Endpoints (if ENABLE_INTEGRATIONS=true)
- **CompanyCam Webhooks**: http://localhost:8000/api/integrations/companycam/webhook
- **Google Sheets Sync**: http://localhost:8000/api/integrations/google-sheets/sync
- **Integration Health**: http://localhost:8000/api/integrations/health

## Configuration & Environment

### Frontend Proxy Configuration
Frontend development server proxies `/api/*` requests to `localhost:8000` automatically via CRACO configuration in `frontend/craco.config.js`.

### Backend Environment Files
Backend uses environment-specific `.env` files in `backend/` directory:
- `.env.development` - Development settings (Docker PostgreSQL, Local Storage)
- `.env.production` - Production settings (Supabase, Google Drive Storage)
- `.env.example` - Template with required variables
- `.env.storage.example` - Storage configuration examples

### Database Configuration

#### Development (Default: Docker PostgreSQL)
```bash
# Start Docker PostgreSQL
docker-compose -f docker-compose.dev.yml up -d

# Database automatically configured via .env.development:
# DATABASE_TYPE=postgresql
# DATABASE_URL=postgresql://mjestimate:dev_password_2024@localhost:5433/mjestimate_dev
```

#### Database Options
1. **Docker PostgreSQL (Development)** - Local development with `docker-compose.dev.yml`
   - PostgreSQL 15 on port 5433
   - PgAdmin on port 8080
   - Redis on port 6379

2. **SQLite (Optional)** - Lightweight development option
   - Set `USE_SQLITE=true` in `.env.development`
   - Set `DATABASE_TYPE=sqlite`

3. **NeonDB (Production)** - Serverless PostgreSQL for production deployment
   - Free tier: 0.5GB storage, 100 CU-hours/month
   - Configured in `.env.production`
   - Auto scale-to-zero when idle
   - See [DEPLOYMENT.md](./DEPLOYMENT.md) for setup guide

## Key Architecture Patterns

This is a full-stack TypeScript/Python application with the following key patterns:

### Backend Pattern (Domain-Driven Design)
Each domain follows a consistent 5-file pattern:
- `models.py` - SQLAlchemy/Pydantic models
- `schemas.py` - API request/response schemas  
- `repository.py` - Data access layer
- `service.py` - Business logic layer
- `api.py` - FastAPI route handlers

### Frontend Architecture
- **Component Organization**: Domain-specific components in `components/` subdirectories
- **State Management**: Zustand for client state, React Query for server state
- **Routing**: React Router v7 with type-safe routing
- **UI Framework**: Ant Design 5.x with Korean locale
- **Build Tool**: CRACO for Create React App configuration override

### Key Technologies
- **Frontend**: React 18 + TypeScript + Ant Design + Zustand + React Query
- **Backend**: FastAPI + Pydantic + SQLAlchemy + PostgreSQL
- **Development**: CRACO (frontend) + Uvicorn hot reload (backend)
- **Database**:
  - Development: Docker PostgreSQL (default)
  - Production: NeonDB (Serverless PostgreSQL)
  - Optional: SQLite for lightweight development
- **File Storage**:
  - Development: Local filesystem (default)
  - Production: Google Drive (30GB free, recommended)
  - Future: AWS S3, Azure Blob (extensible architecture)

## 🚀 Deployment

### Production Deployment (Recommended)
```
Frontend: Vercel (Free)
Backend:  Render ($7/month for always-on with scheduler)
Database: NeonDB (Free tier)
```

**Total Cost**: $7/month for stable production with auto-sync features

### Quick Deploy Guide
1. **Database**: Create NeonDB project at [neon.com](https://neon.com)
2. **Backend**: Deploy to Render using `render.yaml`
3. **Frontend**: Deploy to Vercel with GitHub integration
4. **Configure**: Set environment variables in platform dashboards

📖 **Full deployment guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)

### Deployment Architecture
```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Vercel    │ ───> │    Render    │ ───> │   NeonDB     │
│  (Frontend) │      │  (Backend)   │      │ (PostgreSQL) │
│    무료      │      │    $7/월     │      │     무료      │
└─────────────┘      └──────────────┘      └──────────────┘
        │                    │                      │
        │                    ├──> Google Drive ────┘
        │                    │    (File Storage, 30GB free)
        │                    │
        │                    ├──> Google Sheets (Scheduler: 5min)
        │                    ├──> CompanyCam (Webhook)
        │                    └──> Slack (Notifications)
```

### Why This Stack?
- ✅ **Low Cost**: $7/month for full production
- ✅ **Scheduler Support**: Backend always-on for Google Sheets auto-sync
- ✅ **File Storage**: Google Drive 30GB free, automatic backup
- ✅ **Auto HTTPS**: Both platforms provide free SSL
- ✅ **Auto Deploy**: Git push triggers automatic deployment
- ✅ **Scalable**: Easy to upgrade as traffic grows

## 📦 File Storage System

### Flexible Storage Architecture
The system supports multiple storage providers through a flexible abstraction layer:

**Supported Providers**:
- **Local Storage**: Development (default)
- **Google Drive**: Production (recommended, 30GB free)
- **AWS S3**: Future support (extensible)
- **Azure Blob**: Future support (extensible)

**Key Features**:
- Switch providers via environment variable (no code changes)
- Job-based folder organization
- Automatic thumbnail generation
- Metadata management
- Easy migration between providers

### Quick Setup

**Development (Local Storage)**:
```bash
# .env.development (default)
STORAGE_PROVIDER=local
STORAGE_BASE_DIR=uploads
```

**Production (Google Drive)**:
```bash
# .env.production
STORAGE_PROVIDER=gdrive
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
GDRIVE_ROOT_FOLDER_ID=your_folder_id
```

### Documentation
- **Quick Start**: [backend/docs/STORAGE_QUICK_START.md](./backend/docs/STORAGE_QUICK_START.md) (5 minutes)
- **Complete Setup**: [backend/docs/GOOGLE_CLOUD_SETUP.md](./backend/docs/GOOGLE_CLOUD_SETUP.md)
- **Integration Guide**: [STORAGE_INTEGRATION.md](./STORAGE_INTEGRATION.md)
- **Storage Module**: [backend/app/domains/storage/README.md](./backend/app/domains/storage/README.md)