# DB 마이그레이션 전체 요약

## 🎯 한눈에 보는 워크플로우

### 2-Tier 구조 (스테이징 없음)
```
개발 (Local)                                    프로덕션
     ↓                                              ↓
1. 모델 수정                              → 3. 코드 배포 (자동)
2. sync_db.py + 철저한 테스트           → 4. alembic upgrade head (수동)
3. Git push                               → 5. 즉시 검증 + 모니터링
```

### 3-Tier 구조 (스테이징 있음) - 향후 확장 시
```
개발 (Local)           스테이징                    프로덕션
     ↓                     ↓                          ↓
1. 모델 수정        → 2. 코드 배포              → 4. 코드 배포
2. sync_db.py      → 3. upgrade + 테스트       → 5. upgrade + 검증
3. Git push
```

## 📋 빠른 참조

### 개발 환경 (Local) - 철저한 테스트

```bash
cd backend

# 1. 마이그레이션 생성
python sync_db.py  # 권장 (자동)
# 또는
python -m alembic revision --autogenerate -m "설명"

# 2. 적용 및 테스트
python -m alembic upgrade head
# ⭐ 모든 기능 테스트 (CRUD, API, 성능)

# 3. 롤백 테스트 (필수!)
python -m alembic downgrade -1
python -m alembic upgrade head

# 4. Git 커밋
git add alembic/versions/*.py app/domains/*/models.py
git commit -m "feat: DB 스키마 변경"
git push
```

### 프로덕션 환경 (신중한 배포)

```bash
# 1. 백업 (필수!)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# 2. Dry run (미리보기)
python -m alembic upgrade head --sql > preview.sql

# 3. 배포
git pull origin main  # 자동 배포 또는
python -m alembic upgrade head

# 4. 즉시 검증
python -m alembic current
curl https://your-domain.com/api/health

# 5. 10-30분 모니터링
# - 로그 확인
# - API 응답 확인
# - 사용자 피드백 확인
```

## 🚦 중요 원칙 (2-Tier 구조)

### ✅ 해야 할 것
- **개발 환경에서** 마이그레이션 생성 + **철저한 테스트**
- **롤백 테스트** 필수 수행
- **Git으로** 버전 관리
- **프로덕션 백업** 필수
- **Dry run** 으로 SQL 미리보기
- **프로덕션에서** `upgrade head`만 실행
- **10-30분 모니터링** 필수

### ❌ 하면 안 되는 것
- ❌ 프로덕션에서 `--autogenerate` 실행
- ❌ 백업 없이 마이그레이션 적용
- ❌ 롤백 테스트 없이 배포
- ❌ 여러 변경사항 한번에 배포
- ❌ 배포 후 방치 (모니터링 필수)

## 🛠️ 도구별 사용법

### sync_db.py (개발 환경 전용)

```bash
# 대화형 (권장)
python sync_db.py

# 자동
python sync_db.py --auto

# 체크만
python sync_db.py --check-only

# 초기화 (주의!)
python sync_db.py --force-recreate
```

**기능:**
- DB 연결 확인
- 현재 상태 표시
- 백업 제안
- 자동 마이그레이션 생성
- 검증

### Alembic 명령어

```bash
# 현재 버전
python -m alembic current

# 히스토리
python -m alembic history

# 마이그레이션 생성
python -m alembic revision --autogenerate -m "메시지"

# 적용
python -m alembic upgrade head

# 롤백
python -m alembic downgrade -1

# SQL만 보기
python -m alembic upgrade head --sql
```

## 📚 상세 문서

### 2-Tier 구조 전용
1. **[TWO_TIER_DEPLOYMENT.md](TWO_TIER_DEPLOYMENT.md)** ⭐ **필독!**
   - 스테이징 없는 구조 배포 가이드
   - 위험 요소와 대응 전략
   - 단계별 체크리스트
   - 긴급 롤백 절차

### 일반 가이드
2. **[COMPLETE_DB_SYNC.md](COMPLETE_DB_SYNC.md)**
   - 개발 환경 DB 동기화
   - sync_db.py 사용법
   - 문제 해결

3. **[PRODUCTION_DB_MIGRATION.md](PRODUCTION_DB_MIGRATION.md)**
   - 프로덕션 배포 가이드 (3-Tier 포함)
   - CI/CD 설정
   - Zero-downtime 전략
   - 롤백 절차

4. **[backend/DB_SYNC_GUIDE.md](backend/DB_SYNC_GUIDE.md)**
   - Alembic 상세 사용법
   - 트러블슈팅

## 🔥 긴급 상황

### 마이그레이션 실패 시

```bash
# 1. 백업에서 복원 (가장 안전)
psql $DATABASE_URL < backup.sql

# 2. 또는 롤백
python -m alembic downgrade -1

# 3. 로그 확인
tail -f logs/error.log
```

### 프로덕션 다운 시

```bash
# 1. 이전 코드로 롤백
git revert <commit_hash>
git push

# 2. 또는 DB만 복원
psql $DATABASE_URL < backup.sql

# 3. Health check
curl /api/health
```

## 📊 체크리스트

### 배포 전
- [ ] 개발 환경에서 마이그레이션 테스트 완료
- [ ] Git에 커밋 및 푸시
- [ ] 스테이징 환경에서 테스트
- [ ] 백업 생성 확인

### 배포 중
- [ ] 프로덕션 백업 생성
- [ ] 마이그레이션 적용
- [ ] Health check 통과
- [ ] 로그 확인

### 배포 후
- [ ] 핵심 기능 테스트
- [ ] 성능 모니터링
- [ ] 에러 로그 모니터링
- [ ] 사용자 피드백 확인

## 🎓 예제

### 새 테이블 추가

```python
# app/domains/xxx/models.py
class NewFeature(Base):
    __tablename__ = "new_features"
    id = Column(UUID, primary_key=True)
    name = Column(String(100), nullable=False)
```

```bash
# 개발 환경
cd backend
python sync_db.py
git add alembic/versions/*.py app/domains/xxx/models.py
git commit -m "feat: Add new_features table"
git push

# 프로덕션
git pull
python -m alembic upgrade head
```

### 컬럼 추가

```python
# app/domains/users/models.py
class User(Base):
    # 기존 컬럼들...
    phone = Column(String(20), nullable=True)  # 새 컬럼
```

```bash
# 개발
python sync_db.py
# → alembic/versions/xxx_add_user_phone.py 생성됨

git add . && git commit -m "feat: Add phone to users" && git push

# 프로덕션
git pull && python -m alembic upgrade head
```

## 🔗 관련 파일

- `backend/sync_db.py` - 자동화 스크립트
- `backend/alembic/env.py` - Alembic 설정 (모든 모델 import)
- `backend/alembic/versions/` - 마이그레이션 파일들
- `.github/workflows/deploy.yml` - CI/CD (선택적)
- `render.yaml` - Render 배포 설정 (선택적)

## ❓ FAQ (2-Tier 구조)

**Q: 스테이징 없이 안전하게 배포할 수 있나요?**
A: 가능하지만, 개발 환경에서 **철저한 테스트**가 필수입니다. 특히 롤백 테스트를 반드시 수행하세요.

**Q: 프로덕션에서 자동으로 마이그레이션 적용되나요?**
A: 아니요. 2-Tier 구조에서는 **수동 적용을 강력히 권장**합니다. 백업과 검증이 필수이기 때문입니다.

**Q: 마이그레이션 실패하면 자동 롤백되나요?**
A: 아니요. **즉시 수동으로 롤백**하거나 백업에서 복원해야 합니다. 따라서 배포 전 백업이 필수입니다.

**Q: 여러 변경사항을 한 번에 배포해도 되나요?**
A: **권장하지 않습니다.** 작은 변경사항을 자주 배포하는 것이 안전합니다. 문제 발생 시 원인 파악이 쉽습니다.

**Q: 배포 후 얼마나 모니터링해야 하나요?**
A: **최소 10-30분** 모니터링이 필요합니다. 로그, API 응답, 사용자 피드백을 확인하세요.

**Q: downgrade가 데이터를 복원해주나요?**
A: 아니요. Downgrade는 **스키마만** 되돌립니다. 데이터는 백업에서 복원해야 합니다.

**Q: 비용을 더 낮출 수 있나요?**
A: 현재 구조(Vercel Free + Render $7 + NeonDB Free)가 최적입니다. Render Free는 스케줄러가 없어 자동 동기화가 불가능합니다.

## 🎯 핵심 요약 (2-Tier)

1. **개발**: `python sync_db.py` → **철저한 테스트** → **롤백 테스트** → Git push
2. **프로덕션**: **백업** → Dry run → `alembic upgrade head` → **즉시 검증** → **10-30분 모니터링**
3. **절대 금지**:
   - ❌ 프로덕션에서 `--autogenerate`
   - ❌ 백업 없이 배포
   - ❌ 롤백 테스트 생략
   - ❌ 배포 후 방치

**2-Tier는 더 신중해야 합니다!** ⚠️
