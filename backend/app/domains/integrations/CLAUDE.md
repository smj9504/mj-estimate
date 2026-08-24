# Integrations 도메인 가이드

**통합 모듈 설계:**
- **논리적 분리**: `domains/integrations/` 디렉토리로 격리
- **선택적 활성화**: `ENABLE_INTEGRATIONS` 환경 변수로 제어
- **독립적 에러 핸들링**: 통합 실패가 메인 앱에 영향 없음
- **향후 확장 가능**: 필요시 별도 서비스로 쉽게 분리 가능

#### 통합 기능 관리
- **Feature Toggle**: `ENABLE_INTEGRATIONS=true/false` 환경 변수로 제어
- **조건부 로딩**: 통합 비활성화 시 관련 라우터와 서비스 로드 안 함
- **독립적 에러**: 통합 실패가 메인 앱 동작에 영향 없음
- **Webhook 처리**: CompanyCam, Slack 등 외부 서비스 webhook 수신
- **자동 동기화**: Google Sheets 양방향 동기화
- **알림 전송**: Slack 알림 발송
