# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

React + TypeScript + FastAPI 기반 현대적 견적서/송장 관리 시스템

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

### 백엔드 (FastAPI) - `backend/app/`

#### Domain-Driven Design 구조
```
backend/app/
├── core/                    # 핵심 인프라
│   ├── database.py          # Supabase 연결
│   ├── config.py            # 환경 설정
│   └── interfaces.py        # 추상화 인터페이스
├── common/                  # 공통 컴포넌트
│   └── base_repository.py   # 기본 저장소 패턴
├── domains/                 # 비즈니스 도메인
│   ├── auth/               # 인증/인가
│   ├── company/            # 회사 관리
│   ├── invoice/            # 송장 관리
│   ├── estimate/           # 견적서 관리
│   ├── work_order/         # 작업 지시서
│   └── staff/              # 직원 관리
└── main.py                 # FastAPI 앱 진입점
```

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
- **Supabase** - 데이터베이스 (PostgreSQL)
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

- **프론트엔드**: http://localhost:3000
- **백엔드 API**: http://localhost:8000  
- **API 문서 (Swagger)**: http://localhost:8000/docs
- **API 문서 (ReDoc)**: http://localhost:8000/redoc
- **PgAdmin (when using Docker)**: http://localhost:8080
- **PostgreSQL (Docker)**: localhost:5433

## Configuration & Environment

### Frontend Proxy Configuration
Frontend development server proxies `/api/*` requests to `localhost:8000` automatically via CRACO configuration in `frontend/craco.config.js`.

### Backend Environment Files
Backend uses environment-specific `.env` files in `backend/` directory:
- `.env.development` - Development settings
- `.env.production` - Production settings  
- `.env.example` - Template with required variables

Required variables include Supabase credentials, JWT secrets, and database URLs.

### Development Database Options
1. **Supabase (Cloud)** - Default for development
2. **Docker Compose** - Local PostgreSQL + Redis + PgAdmin via `docker-compose.dev.yml`

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
- **Backend**: FastAPI + Pydantic + SQLAlchemy + Supabase
- **Development**: CRACO (frontend) + Uvicorn hot reload (backend)
- **Database**: Supabase (PostgreSQL) with optional Docker Compose for local development