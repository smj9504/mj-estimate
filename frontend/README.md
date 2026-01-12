# MJ Estimate Frontend

React 18 + TypeScript 기반 프론트엔드 애플리케이션. Ant Design UI 라이브러리와 현대적인 상태 관리를 사용하는 견적서/송장 관리 시스템.

## 프로젝트 구조

```
frontend/src/
├── components/              # 재사용 가능한 컴포넌트
│   ├── common/             # 공통 컴포넌트
│   │   ├── Layout.tsx      # 메인 레이아웃
│   │   ├── PageLoader.tsx  # 로딩 스피너
│   │   └── ProtectedRoute.tsx  # 인증 라우트 가드
│   ├── estimate/           # 견적서 관련 컴포넌트
│   ├── invoice/            # 송장 관련 컴포넌트
│   ├── work-order/         # 작업 지시서 컴포넌트
│   └── water-mitigation/   # 수해복구 컴포넌트
├── pages/                   # 페이지 컴포넌트
│   ├── Dashboard.tsx       # 대시보드
│   ├── DocumentList.tsx    # 문서 목록
│   ├── WaterMitigationList.tsx  # 수해복구 작업 목록
│   ├── WaterMitigationDetail.tsx  # 수해복구 상세
│   └── ...
├── services/               # API 통신 서비스
│   ├── api.ts              # Axios 인스턴스
│   ├── waterMitigationService.ts  # Water Mitigation API
│   ├── estimateService.ts  # 견적서 API
│   └── ...
├── contexts/               # React Context
│   └── AuthContext.tsx     # 인증 상태 관리
├── hooks/                   # 커스텀 훅
├── types/                   # TypeScript 타입 정의
├── utils/                   # 유틸리티 함수
├── styles/                  # 전역 스타일
├── App.tsx                 # 메인 앱 컴포넌트
└── index.tsx               # 진입점
```

## 주요 기능

### Water Mitigation (수해복구)
- 작업 현장 목록 및 상세 보기
- 사진 업로드 및 카테고리 분류
- AI 기반 사진 자동 분류
- Scope of Work 생성 및 관리
- CompanyCam 연동

### Estimate/Invoice (견적서/송장)
- 문서 생성, 수정, 삭제
- PDF 생성 및 미리보기
- 이메일 발송
- Excel 내보내기
- 문서 복제

### Work Order (작업 지시서)
- 작업 지시서 관리
- 사진/문서 첨부
- PDF 생성

## 설치 및 실행

### 1. 의존성 설치

```bash
cd frontend
npm install
```

### 2. 환경 설정

개발 환경 (.env 파일):
```env
REACT_APP_API_URL=http://localhost:8000
```

프로덕션 환경 (.env.production 파일):
```env
REACT_APP_API_URL=https://your-api-domain.com
```

### 3. 개발 서버 실행

```bash
npm start
```

http://localhost:3000 에서 접근 가능

### 4. 프로덕션 빌드

```bash
npm run build
```

빌드 결과물은 `build/` 폴더에 생성됩니다.

## 스크립트

```bash
npm start          # 개발 서버 실행
npm run build      # 프로덕션 빌드
npm run build:dev  # 개발 빌드
npm test           # 테스트 실행
npm run lint       # ESLint 검사
```

## 기술 스택

### Core
- **React 18**: 사용자 인터페이스
- **TypeScript**: 타입 안전성
- **React Router v7**: 클라이언트 사이드 라우팅

### UI
- **Ant Design 5.x**: UI 컴포넌트 라이브러리
- **Ant Design Icons**: 아이콘
- **Day.js**: 날짜 처리 (Ant Design 통합)

### 상태 관리
- **Zustand**: 클라이언트 상태 관리
- **React Query**: 서버 상태 관리 및 캐싱

### 빌드 및 개발
- **CRACO**: Create React App 설정 오버라이드
- **Babel**: JavaScript 트랜스파일링
- **ESLint**: 코드 품질 검사

### 통신
- **Axios**: HTTP 클라이언트

## 새 페이지 추가 가이드

### 1. 페이지 컴포넌트 생성

```typescript
// src/pages/NewFeature.tsx
import React from 'react';

const NewFeature: React.FC = () => {
  return <div>New Feature Page</div>;
};

export default NewFeature;
```

### 2. Lazy Import 추가 (App.tsx)

```typescript
// App.tsx 상단
const NewFeature = lazy(() => import('./pages/NewFeature'));
```

### 3. 라우트 등록

```typescript
// App.tsx 라우터 내부
{
  path: "/new-feature",
  element: (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <NewFeature />
        </Suspense>
      </Layout>
    </ProtectedRoute>
  )
}
```

주의사항:
- 반드시 `<Suspense>`로 감싸야 합니다
- `fallback`은 `<PageLoader />`를 사용합니다
- import 경로에 .tsx 확장자는 제외합니다

## 프록시 설정

개발 환경에서 `/api/*` 요청은 자동으로 `localhost:8000`으로 프록시됩니다.

설정 파일: `craco.config.js`

```javascript
devServer: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true
    }
  }
}
```

## 폴더 구조 규칙

### components/
- `common/`: 여러 도메인에서 사용되는 공통 컴포넌트
- `{domain}/`: 특정 도메인 전용 컴포넌트

### services/
- 각 도메인별 API 서비스 파일
- axios 인스턴스 및 인터셉터 설정

### types/
- API 응답 타입
- 컴포넌트 Props 타입
- 공통 유틸리티 타입

## 코드 스타일

- TypeScript strict mode 사용
- 함수형 컴포넌트 + Hooks 패턴
- Ant Design 컴포넌트 우선 사용
- Korean locale 기본 설정

## 프로덕션 배포

### Vercel 배포 (권장)

1. GitHub 연동
2. Build Command: `npm run build`
3. Output Directory: `build`
4. 환경 변수 설정: `REACT_APP_API_URL`

### 정적 호스팅

```bash
npm run build
# build/ 폴더를 웹 서버에 배포
```

## 트러블슈팅

### CORS 오류
- 개발: CRACO 프록시 설정 확인
- 프로덕션: 백엔드 CORS_ORIGINS 설정 확인

### 빌드 오류
- `node_modules` 삭제 후 `npm install` 재실행
- TypeScript 타입 오류 확인

### 상태 동기화 문제
- React Query devtools로 캐시 상태 확인
- Zustand devtools로 상태 변화 추적
