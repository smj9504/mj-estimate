# 2-Tier 배포 가이드 (스테이징 없는 구조)

비용 절감을 위한 **개발환경 → 프로덕션** 직행 배포 구조 가이드입니다.

## 🎯 2-Tier 구조 개요

```
개발 환경 (Local)                프로덕션 (Production)
     ↓                                  ↓
1. 모델 수정                    → 4. 코드 배포 (자동)
2. 마이그레이션 생성            → 5. DB 마이그레이션 (수동)
3. ⭐ 철저한 테스트             → 6. 즉시 검증
   (스테이징 대체)                   (문제 시 즉시 롤백)
```

## ⚠️ 2-Tier의 추가 위험과 대응

### 위험 요소
1. **테스트 환경 부족**: 프로덕션과 유사한 환경에서 테스트 불가
2. **롤백 부담 증가**: 실사용자 데이터에 즉시 영향
3. **디버깅 어려움**: 프로덕션에서 발생한 문제 재현 어려움

### 대응 전략
1. **개발 환경 테스트 강화**
   - 모든 시나리오 테스트 (정상 케이스 + 에러 케이스)
   - 롤백 테스트 필수
   - 성능 테스트 포함

2. **백업 자동화**
   - 배포 전 자동 백업
   - 백업 파일 7일 보관

3. **점진적 배포**
   - 업무 시간 외 배포
   - 소량 변경부터 시작
   - 모니터링 강화

## 📋 단계별 체크리스트

### 개발 환경 (배포 전)

#### 1. 코드 변경
```bash
# 모델 수정
# backend/app/domains/xxx/models.py
```

#### 2. 마이그레이션 생성
```bash
cd backend
python sync_db.py

# 또는 수동
python -m alembic revision --autogenerate -m "descriptive_message"
```

#### 3. 마이그레이션 파일 검토 (⭐ 매우 중요)
```bash
# alembic/versions/xxxxx_descriptive_message.py 열어서 확인

# 체크 항목:
# ❌ DROP TABLE 명령 → 데이터 손실!
# ❌ DROP COLUMN 명령 → 데이터 손실!
# ⚠️ ALTER COLUMN TYPE → 데이터 변환 확인
# ⚠️ NOT NULL 추가 → 기존 null 데이터 처리
# ✅ CREATE TABLE → 문제없음
# ✅ ADD COLUMN → nullable이면 문제없음
# ✅ CREATE INDEX → 성능 영향만 있음
```

#### 4. 로컬 적용 및 테스트
```bash
# 마이그레이션 적용
python -m alembic upgrade head

# 현재 버전 확인
python -m alembic current
```

#### 5. ⭐ 철저한 기능 테스트 (스테이징 대체)
```bash
# 백엔드 서버 재시작
cd backend
python -m uvicorn app.main:app --reload

# 테스트 체크리스트:
# □ 모든 API 엔드포인트 테스트
# □ CRUD 작업 테스트 (Create, Read, Update, Delete)
# □ 데이터 무결성 확인
# □ 외래키 관계 테스트
# □ 에러 케이스 테스트 (잘못된 입력, 중복 데이터 등)
# □ 성능 테스트 (대량 데이터 조회/생성)
# □ 기존 기능 정상 작동 확인 (Regression Test)
```

#### 6. 롤백 테스트
```bash
# 한 단계 롤백
python -m alembic downgrade -1

# 다시 적용
python -m alembic upgrade head

# 데이터 확인: 롤백 후에도 데이터 손실 없는지 확인
```

#### 7. Git 커밋
```bash
git add alembic/versions/*.py
git add app/domains/*/models.py
git commit -m "feat: [기능 설명] with DB migration

- Model changes: [변경 내용 요약]
- Migration: [마이그레이션 파일 이름]
- Tested: [테스트 항목]
"
git push origin main
```

### 프로덕션 배포 (신중한 단계)

#### 8. 배포 전 확인
```bash
# 프로덕션 서버 접속 (Render Dashboard 또는 SSH)

# 1. 현재 DB 버전 확인
cd backend
python -m alembic current

# 2. 보류 중인 마이그레이션 확인
python -m alembic history
```

#### 9. 백업 생성 (⭐ 필수!)
```bash
# NeonDB 백업 (Dashboard에서 수동 스냅샷 생성)
# 또는

# PostgreSQL 백업
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 백업 파일 안전한 곳에 저장
# - 로컬 다운로드
# - S3/GCS 업로드
# - 다른 서버에 백업
```

#### 10. Dry Run (SQL 미리보기)
```bash
# 실제 적용 전 SQL 확인
python -m alembic upgrade head --sql > migration_preview.sql

# 파일 내용 확인
cat migration_preview.sql

# 위험한 명령 있는지 재확인:
# - DROP
# - DELETE
# - TRUNCATE
```

#### 11. 마이그레이션 적용
```bash
# 실제 적용
python -m alembic upgrade head

# 에러 발생 시 즉시 중단하고 백업으로 복구!
```

#### 12. 즉시 검증
```bash
# 1. DB 버전 확인
python -m alembic current

# 2. 테이블 존재 확인
psql $DATABASE_URL
\dt  # 테이블 목록
\d table_name  # 테이블 구조

# 3. Health Check
curl https://your-domain.com/api/health

# 4. 핵심 기능 테스트
# - 로그인
# - 데이터 조회
# - 데이터 생성
```

#### 13. 모니터링 (10-30분)
```bash
# Render Dashboard 로그 실시간 확인
# 에러 로그 모니터링
# API 응답 시간 확인
# 사용자 피드백 확인
```

## 🔥 긴급 롤백 절차

### 마이그레이션 실패 시

```bash
# 방법 1: Alembic Downgrade (빠름)
python -m alembic downgrade -1

# 방법 2: 백업 복원 (안전)
psql $DATABASE_URL < backup_20250103_120000.sql
```

### 코드 문제 발생 시

```bash
# Git Revert
git revert HEAD
git push origin main

# Render 자동 재배포 대기 (또는 수동 트리거)
```

## 📊 배포 체크리스트

### 배포 전
- [ ] 마이그레이션 파일 검토 완료
- [ ] 로컬에서 upgrade/downgrade 테스트 완료
- [ ] 모든 기능 테스트 완료
- [ ] Git push 완료
- [ ] 프로덕션 백업 생성 완료

### 배포 중
- [ ] Dry run으로 SQL 확인 완료
- [ ] 마이그레이션 적용 완료
- [ ] Health check 통과
- [ ] 핵심 기능 동작 확인

### 배포 후 (10-30분 모니터링)
- [ ] 로그에 에러 없음
- [ ] API 응답 정상
- [ ] 사용자 접근 가능
- [ ] 데이터 무결성 확인

## 🎓 예제: CompanyCam 웹훅 테이블 추가

### 개발 환경
```bash
# 1. 모델 추가 (이미 완료)
# backend/app/domains/integrations/models.py
# backend/app/domains/integrations/companycam/models.py

# 2. 마이그레이션 생성
cd backend
python sync_db.py

# 3. 생성된 파일 확인
# alembic/versions/xxxxx_add_companycam_tables.py

# 4. 로컬 적용
python -m alembic upgrade head

# 5. 테스트
# - CompanyCam webhook 수신 테스트
# - Lead 자동 생성 테스트
# - 사진 다운로드 테스트

# 6. 롤백 테스트
python -m alembic downgrade -1
python -m alembic upgrade head

# 7. Git 커밋
git add alembic/versions/xxxxx_add_companycam_tables.py
git add app/domains/integrations/models.py
git add app/domains/integrations/companycam/models.py
git commit -m "feat: Add CompanyCam webhook integration tables

- Added webhook_events table for all integration webhooks
- Added companycam_photos table for photo metadata
- Tested: webhook processing, lead creation, photo download
"
git push origin main
```

### 프로덕션 배포
```bash
# 8. Render 자동 배포 대기
# (또는 Dashboard에서 수동 Deploy)

# 9. 배포 완료 후 서버 접속
# Render Dashboard → Shell

# 10. 백업
pg_dump $DATABASE_URL > backup_companycam_$(date +%Y%m%d).sql

# 11. Dry run
python -m alembic upgrade head --sql

# 12. 적용
python -m alembic upgrade head

# 13. 검증
python -m alembic current
psql $DATABASE_URL
\dt webhook_events
\dt companycam_photos

# 14. CompanyCam webhook 테스트
# - CompanyCam에서 사진 업로드
# - Render 로그 확인
# - Lead 생성 확인
```

## 💡 Best Practices

### DO ✅
1. **작은 단위로 배포**: 한 번에 하나의 큰 기능보다 여러 번의 작은 배포
2. **업무 시간 외 배포**: 사용자 영향 최소화
3. **백업 자동화**: 배포 스크립트에 백업 포함
4. **모니터링 강화**: 배포 후 최소 30분 모니터링
5. **문서화**: 모든 배포 과정과 결과 기록

### DON'T ❌
1. **급하게 배포하지 말기**: 충분한 테스트 시간 확보
2. **여러 변경사항 한 번에 배포하지 말기**: 문제 발생 시 원인 파악 어려움
3. **백업 없이 배포하지 말기**: 복구 불가능한 상황 방지
4. **프로덕션에서 실험하지 말기**: 모든 테스트는 개발 환경에서
5. **배포 후 방치하지 말기**: 최소 30분 모니터링 필수

## 🔗 관련 문서

- [DB_MIGRATION_SUMMARY.md](./DB_MIGRATION_SUMMARY.md) - 빠른 참조
- [PRODUCTION_DB_MIGRATION.md](./PRODUCTION_DB_MIGRATION.md) - 상세 가이드
- [COMPLETE_DB_SYNC.md](./COMPLETE_DB_SYNC.md) - 개발환경 동기화

## ❓ FAQ

**Q: 스테이징 없이 안전하게 배포할 수 있나요?**
A: 가능하지만, 개발 환경에서 철저한 테스트가 필수입니다. 특히 롤백 테스트를 반드시 수행하세요.

**Q: 배포 중 문제 발생하면?**
A: 즉시 중단하고 백업으로 복구합니다. 롤백 후 원인 파악하고 개발 환경에서 재테스트합니다.

**Q: 얼마나 자주 배포해야 하나요?**
A: 작은 변경사항을 자주 배포하는 것이 안전합니다. 큰 변경사항을 모아서 배포하면 위험도가 높아집니다.

**Q: 비용을 더 낮출 수 있나요?**
A: 현재 구조(Vercel Free + Render $7 + NeonDB Free)가 최적입니다. Render Free 플랜은 스케줄러가 없어 Google Sheets 자동 동기화가 불가능합니다.

**Q: 나중에 스테이징 환경 추가하려면?**
A: Render에서 서비스 하나 더 생성하고, NeonDB에서 staging 데이터베이스를 추가로 만들면 됩니다. 추가 비용은 Render $7/월입니다.
