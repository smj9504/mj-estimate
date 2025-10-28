# MJ Estimate - 배포 가이드

최소 비용으로 React + FastAPI 애플리케이션을 배포하는 가이드입니다.

## 📊 배포 아키텍처

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Vercel    │ ───> │    Render    │ ───> │   NeonDB     │
│  (Frontend) │      │  (Backend)   │      │ (PostgreSQL) │
│    무료      │      │   $0 or $7   │      │     무료      │
└─────────────┘      └──────────────┘      └──────────────┘
```

## 💰 비용 옵션

### Option 1: 완전 무료 ($0/월)
- Frontend: Vercel 무료
- Backend: Render 무료 (15분 idle 후 sleep)
- Database: NeonDB 무료 (0.5GB, 100 CU-hours)

**제한사항**:
- 콜드 스타트 (3-5초 지연)
- Google Sheets 스케줄러 불안정 (15분 idle 시 중단)

### Option 2: 스케줄러 안정화 ($7/월) ⭐ 추천
- Frontend: Vercel 무료
- Backend: Render $7/월 (항상 활성)
- Database: NeonDB 무료

**장점**:
- 안정적인 Google Sheets 자동 동기화 (5분마다)
- 콜드 스타트 없음
- 빠른 응답 속도

---

## 🚀 배포 단계

### 1️⃣ NeonDB 설정 (데이터베이스)

#### 1.1 NeonDB 프로젝트 생성
1. [neon.com](https://neon.com) 가입
2. "Create Project" 클릭
3. 프로젝트 이름: `mjestimate`
4. Region: 가까운 지역 선택 (예: `US East`)
5. PostgreSQL 버전: 15 이상

#### 1.2 연결 정보 확보
Dashboard에서 **Connection String** 복사:
```
postgresql://user:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

#### 1.3 데이터베이스 초기화 (선택사항)
```bash
# 로컬에서 스키마 마이그레이션 (필요시)
psql "<NeonDB_Connection_String>" < backend/migrations/init.sql
```

---

### 2️⃣ Backend 배포 (Render)

#### 2.1 GitHub 저장소 준비
```bash
# Git 저장소 초기화 (아직 안했다면)
git init
git add .
git commit -m "Initial commit for deployment"

# GitHub에 푸시
git remote add origin https://github.com/your-username/mj-react-app.git
git push -u origin main
```

#### 2.2 Render 프로젝트 생성
1. [render.com](https://render.com) 가입
2. "New +" → "Blueprint" 선택
3. GitHub 저장소 연결
4. `render.yaml` 파일 자동 감지

#### 2.3 환경변수 설정
Render Dashboard에서 다음 환경변수 추가:

**필수 환경변수**:
```bash
# Database
DATABASE_URL=<NeonDB Connection String>

# Security
SECRET_KEY=<Generate using: python -c "import secrets; print(secrets.token_urlsafe(32))">

# Integration Settings
ENABLE_INTEGRATIONS=true
GOOGLE_API_KEY=<Your Google API Key>
GOOGLE_SHEETS_WATER_MITIGATION_ID=<Your Spreadsheet ID>
COMPANYCAM_API_KEY=<Your CompanyCam API Key>
COMPANYCAM_WEBHOOK_TOKEN=<Your CompanyCam Webhook Token>
SLACK_WEBHOOK_URL=<Your Slack Webhook URL>
SLACK_CHANNEL=#water-mitigation

# Storage (Google Cloud Storage)
STORAGE_PROVIDER=gcs
GCS_BUCKET_NAME=mj-estimate-storage
GCS_SERVICE_ACCOUNT_FILE=/etc/secrets/service-account-key.json
GCS_MAKE_PUBLIC=false

# CORS (will be updated after frontend deploy)
CORS_ORIGINS=["https://your-frontend.vercel.app"]
FRONTEND_URL=https://your-frontend.vercel.app
```

#### 2.4 GCS Service Account Secret 업로드
Render Dashboard에서 Service Account 키 파일 업로드:

1. Render Dashboard → Your Service → "Environment" 탭
2. "Secret Files" 섹션 찾기
3. "Add Secret File" 클릭
4. **Filename**: `/etc/secrets/service-account-key.json`
5. **Contents**: `backend/secrets/service-account-key.json` 파일 내용 복사하여 붙여넣기
6. "Save" 클릭

**중요**: Service Account에 Storage Admin 권한이 있는지 확인:
- [GCS Permissions](https://console.cloud.google.com/storage/browser/mj-estimate-storage;tab=permissions)
- Service Account: `mj-estimate@mj-estimate.iam.gserviceaccount.com`
- Role: "Storage Admin"

#### 2.5 플랜 선택
- **Free Plan**: 테스트용 (15분 idle 후 sleep)
- **Starter Plan ($7/월)**: 프로덕션용 (항상 활성, 스케줄러 안정)

#### 2.6 배포 확인
1. Render 자동 빌드 및 배포
2. Backend URL 확인: `https://mjestimate-backend.onrender.com`
3. Health check: `https://mjestimate-backend.onrender.com/health`
4. API Docs: `https://mjestimate-backend.onrender.com/docs`
5. GCS 연결 확인: Logs에서 "Creating GCS storage provider" 메시지 확인

---

### 3️⃣ Frontend 배포 (Vercel)

#### 3.1 Vercel 프로젝트 생성
1. [vercel.com](https://vercel.com) 가입
2. "Add New..." → "Project" 선택
3. GitHub 저장소 import
4. Root Directory: `frontend` 설정

#### 3.2 빌드 설정
Vercel가 자동 감지하지만, 수동 설정 필요시:
```
Framework Preset: Create React App
Build Command: npm run build
Output Directory: build
Install Command: npm install
```

#### 3.3 환경변수 설정
Vercel Dashboard → Settings → Environment Variables:
```bash
REACT_APP_API_URL=https://mjestimate-backend.onrender.com
REACT_APP_GOOGLE_SHEETS_WATER_MITIGATION_ID=<Your Spreadsheet ID>
```

#### 3.4 배포 및 확인
1. Vercel 자동 배포
2. Frontend URL: `https://your-project.vercel.app`
3. 브라우저에서 접속 테스트

---

### 4️⃣ CORS 설정 업데이트

Frontend 배포 완료 후 Backend CORS 설정 업데이트:

1. Render Dashboard → mjestimate-backend → Environment
2. `CORS_ORIGINS` 업데이트:
```json
["https://your-project.vercel.app","https://your-custom-domain.com"]
```
3. `FRONTEND_URL` 업데이트:
```
https://your-project.vercel.app
```
4. Render 서비스 재시작

---

## ✅ 배포 확인 체크리스트

### Backend 확인
- [ ] Health check 응답: `GET /health`
- [ ] API Docs 접근: `/docs`
- [ ] Database 연결 성공
- [ ] 스케줄러 로그 확인 (Render logs)

### Frontend 확인
- [ ] 메인 페이지 로드
- [ ] API 호출 성공 (Network 탭)
- [ ] 로그인 기능
- [ ] 데이터 CRUD 작동

### Integration 확인
- [ ] Google Sheets 수동 동기화 버튼
- [ ] Google Sheets 자동 동기화 (5분 후 로그 확인)
- [ ] CompanyCam Webhook 수신
- [ ] Slack 알림 전송

---

## 🔧 트러블슈팅

### 문제: Backend가 시작되지 않음
**원인**: 환경변수 누락 또는 잘못된 DATABASE_URL

**해결**:
1. Render Logs 확인
2. 필수 환경변수 모두 설정되었는지 확인
3. DATABASE_URL 형식 검증: `postgresql://...?sslmode=require`

### 문제: Frontend에서 API 호출 실패 (CORS 에러)
**원인**: CORS_ORIGINS에 Frontend URL 미등록

**해결**:
1. Render Dashboard에서 `CORS_ORIGINS` 확인
2. Vercel URL 정확히 추가 (https:// 포함, 끝에 / 없이)
3. Backend 재시작

### 문제: Google Sheets 스케줄러가 작동하지 않음
**원인**: Render Free Plan 사용 (15분 idle 후 sleep)

**해결**:
1. Render Starter Plan ($7/월)로 업그레이드
2. 또는 수동 동기화 버튼만 사용

### 문제: PDF 생성 실패
**원인**: Playwright/WeasyPrint 시스템 의존성 누락

**해결**:
1. `render.yaml`에서 `playwright install chromium` 확인
2. Dockerfile의 시스템 패키지 설치 확인
3. Render logs에서 에러 메시지 확인

### 문제: Database 연결 타임아웃
**원인**: NeonDB Compute Unit 소진 또는 네트워크 문제

**해결**:
1. NeonDB Dashboard에서 Usage 확인
2. Free tier 한도: 0.5GB storage, 100 CU-hours/월
3. Scale to zero 설정 확인 (자동 중지/시작)

---

## 📊 모니터링

### Render Logs
```bash
# 실시간 로그 확인
Render Dashboard → Logs tab

# 스케줄러 로그 검색
"Starting scheduled Google Sheets sync"
"Scheduled sync completed"
```

### NeonDB Metrics
```bash
# Dashboard에서 확인
- Storage Usage: 0.5GB 이하 유지
- Compute Hours: 100 hours/월 이하
- Active Time: 실제 사용 시간만 카운트
```

### Vercel Analytics
```bash
# Dashboard에서 확인
- Page Views
- Load Time
- Core Web Vitals
```

---

## 🔄 업데이트 배포

### Backend 업데이트
```bash
git add .
git commit -m "Update backend features"
git push origin main

# Render가 자동으로 재배포
```

### Frontend 업데이트
```bash
git add .
git commit -m "Update frontend features"
git push origin main

# Vercel이 자동으로 재빌드 및 배포
```

---

## 🔒 보안 권장사항

1. **환경변수 관리**
   - `.env` 파일은 Git에 커밋하지 않기
   - 민감한 정보는 플랫폼 Dashboard에서만 설정

2. **SECRET_KEY 생성**
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. **API 키 보호**
   - Backend 환경변수로만 관리
   - Frontend에는 절대 노출하지 않기

4. **HTTPS 사용**
   - Render, Vercel 모두 자동 HTTPS 제공
   - 모든 연결에 HTTPS 사용

---

## 📚 추가 자료

- [Render Documentation](https://render.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [NeonDB Documentation](https://neon.tech/docs)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Create React App Deployment](https://create-react-app.dev/docs/deployment/)

---

## 🆘 도움이 필요하면

- GitHub Issues: [프로젝트 Issues 페이지]
- Email: [관리자 이메일]
- Slack: [팀 Slack 채널]
