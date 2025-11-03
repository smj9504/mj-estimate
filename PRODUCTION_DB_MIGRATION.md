# 프로덕션 DB 마이그레이션 가이드

개발 환경에서 생성된 마이그레이션을 프로덕션 환경에 안전하게 적용하는 방법입니다.

## ⚠️ 중요 원칙

### ❌ 절대 하지 말아야 할 것
- **프로덕션에서 `--autogenerate` 실행 금지**
  - 자동 감지는 예측 불가능
  - 데이터 손실 위험
  - 롤백 불가능한 변경 가능

- **검증 없이 바로 적용 금지**
  - 스테이징 환경에서 먼저 테스트
  - 백업 없이 적용 금지

### ✅ 올바른 방법 (2-Tier 구조)
1. **개발 환경에서** 마이그레이션 생성 및 **철저한 테스트**
2. **Git으로** 마이그레이션 파일 버전 관리
3. **프로덕션 백업** 필수 생성
4. **프로덕션에서** `alembic upgrade head`만 실행
5. **즉시 검증** 및 롤백 준비

## 🔄 전체 워크플로우 (2-Tier: 개발 → 프로덕션)

### 단계 1: 개발 환경 (Local) - 철저한 테스트 필수

```bash
cd backend

# 1. 코드에서 모델 변경
# app/domains/xxx/models.py 수정

# 2. 마이그레이션 생성
python sync_db.py
# 또는
python -m alembic revision --autogenerate -m "add_new_feature"

# 3. 생성된 마이그레이션 파일 철저히 검토
# alembic/versions/xxxxx_add_new_feature.py
# ⚠️ 스테이징 없으므로 더욱 신중하게 검토!
#   - DROP 명령어 있는지 확인 (데이터 손실 위험)
#   - ALTER TABLE 명령 검토
#   - 인덱스 생성/삭제 검토
#   - 외래키 제약조건 검토

# 4. 로컬에서 적용 및 테스트
python -m alembic upgrade head

# 5. ⭐ 개발 환경에서 철저한 기능 테스트 (스테이징 대체)
# - 모든 CRUD 작업 테스트
# - API 엔드포인트 모두 테스트
# - 데이터 무결성 확인
# - 성능 테스트
# - 에러 시나리오 테스트

# 6. Downgrade 테스트 (롤백 가능 여부 확인)
python -m alembic downgrade -1
python -m alembic upgrade head

# 7. 최종 확인 후 Git 커밋
git add alembic/versions/xxxxx_add_new_feature.py
git add app/domains/xxx/models.py
git commit -m "feat: Add new feature with database migration"
git push origin main
```

### 단계 2: 프로덕션 환경 (신중한 배포)

```bash
# 배포 서버에서 (NeonDB, Render 등)

# === 배포 전 준비 ===

# 1. 유지보수 모드 활성화 (선택적)
# - 사용자에게 공지
# - 읽기 전용 모드 전환 (선택적)

# 2. 백업 (자동 + 수동)
# NeonDB: 자동 백업 확인 + 수동 스냅샷 생성
# Render: 데이터베이스 백업 생성

# PostgreSQL 수동 백업
pg_dump $DATABASE_URL > backup_prod_$(date +%Y%m%d_%H%M%S).sql

# === 배포 실행 ===

# 3. 최신 코드 배포
git pull origin main
# 또는 Render/Vercel 자동 배포

# 4. 의존성 설치 (필요시)
pip install -r requirements.txt

# 5. 마이그레이션 적용
python -m alembic upgrade head

# 6. 애플리케이션 재시작
# Render: 자동 재시작
# 수동: systemctl restart myapp

# === 배포 후 검증 ===

# 7. Health check
curl https://your-domain.com/api/health

# 8. 핵심 기능 테스트
# - API 엔드포인트 테스트
# - 데이터 조회/생성 테스트
# - CompanyCam webhook 테스트 (해당되는 경우)

# 9. 로그 모니터링
# Render: Dashboard에서 로그 확인
tail -f /var/log/myapp/error.log

# 10. 유지보수 모드 해제
```

## 📦 배포 자동화 (CI/CD)

### GitHub Actions 예시

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2

    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.11'

    - name: Install dependencies
      run: |
        cd backend
        pip install -r requirements.txt

    - name: Check migrations
      run: |
        cd backend
        python -m alembic check
        # 보류 중인 마이그레이션이 있는지 확인

    - name: Run database migrations (Staging)
      env:
        DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
      run: |
        cd backend
        python -m alembic upgrade head

    - name: Run tests
      run: |
        cd backend
        pytest tests/

    - name: Deploy to Render
      if: success()
      uses: JorgeLNJunior/render-deploy@v1.4.4
      with:
        service_id: ${{ secrets.RENDER_SERVICE_ID }}
        api_key: ${{ secrets.RENDER_API_KEY }}
        wait_deploy: true

    - name: Run database migrations (Production)
      if: success()
      env:
        DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
      run: |
        cd backend
        python -m alembic upgrade head

    - name: Health check
      if: success()
      run: |
        sleep 30  # 서버 시작 대기
        curl -f https://your-domain.com/api/health || exit 1

    - name: Notify on failure
      if: failure()
      uses: 8398a7/action-slack@v3
      with:
        status: ${{ job.status }}
        webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Render.yaml (자동 마이그레이션 포함)

`render.yaml`:

```yaml
services:
  - type: web
    name: mjestimate-backend
    env: python
    region: oregon
    plan: starter  # 또는 free
    buildCommand: |
      cd backend
      pip install -r requirements.txt
    # 프로덕션에서 마이그레이션 자동 실행 (선택적)
    preDeployCommand: |
      cd backend
      python -m alembic upgrade head
    startCommand: |
      cd backend
      uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: mjestimate-db
          property: connectionString
      - key: ENABLE_INTEGRATIONS
        value: true
      - key: COMPANYCAM_API_KEY
        sync: false  # 수동으로 설정
      - key: COMPANYCAM_WEBHOOK_TOKEN
        sync: false

databases:
  - name: mjestimate-db
    databaseName: mjestimate_prod
    user: mjestimate
    plan: free  # NeonDB 사용 시 불필요
```

## 🛡️ 안전한 마이그레이션 체크리스트

### 배포 전 (개발 환경)
- [ ] 마이그레이션이 올바르게 생성되었는지 확인
- [ ] `upgrade()`와 `downgrade()` 함수 모두 테스트
- [ ] 데이터 손실 가능성 검토 (DROP TABLE, DROP COLUMN)
- [ ] 인덱스 추가로 성능 저하 없는지 확인
- [ ] 대량 데이터에 대한 영향 검토
- [ ] Git에 커밋 (마이그레이션 파일 포함)

### 배포 전 (스테이징)
- [ ] 스테이징 DB 백업 생성
- [ ] 마이그레이션 적용
- [ ] 기능 테스트 (E2E)
- [ ] 성능 테스트
- [ ] 롤백 테스트

### 배포 중 (프로덕션)
- [ ] 유지보수 공지 (필요시)
- [ ] 프로덕션 DB 백업 (자동 + 수동)
- [ ] 마이그레이션 적용
- [ ] Health check
- [ ] 로그 모니터링

### 배포 후
- [ ] 핵심 기능 테스트
- [ ] 성능 모니터링
- [ ] 에러 로그 확인
- [ ] 사용자 피드백 모니터링

## 🔥 긴급 롤백 절차

마이그레이션 후 문제 발생 시:

### 방법 1: Alembic Downgrade

```bash
# 한 단계 뒤로
python -m alembic downgrade -1

# 특정 버전으로
python -m alembic downgrade <revision_id>

# 처음으로
python -m alembic downgrade base
```

**⚠️ 주의:**
- Downgrade가 데이터를 복원하지는 않음
- DROP COLUMN의 downgrade는 빈 컬럼 생성
- 데이터 손실 가능

### 방법 2: 백업에서 복원 (더 안전)

```bash
# PostgreSQL
psql $DATABASE_URL < backup_prod_20250103_120000.sql

# NeonDB
# Dashboard에서 스냅샷 복원
```

### 방법 3: 긴급 Hotfix

```bash
# 1. 이전 버전 코드로 롤백
git revert <commit_hash>
git push origin main

# 2. 재배포 (마이그레이션 제외)

# 3. DB는 그대로 두고 코드만 롤백
# (마이그레이션이 additive인 경우 안전)
```

## 📊 마이그레이션 모니터링

### NeonDB 모니터링

```bash
# 연결
psql $DATABASE_URL

# 현재 마이그레이션 버전
SELECT * FROM alembic_version;

# 테이블 크기
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# 최근 변경된 테이블
SELECT
    schemaname,
    tablename,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
ORDER BY last_autovacuum DESC NULLS LAST
LIMIT 10;
```

### Render 로그 모니터링

```bash
# Render Dashboard에서:
# 1. Service → Logs 탭
# 2. "alembic" 검색
# 3. 마이그레이션 실행 로그 확인

# 로그 예시:
# INFO  [alembic.runtime.migration] Running upgrade 5fa2df040a3d -> abc123, add_new_feature
```

## 🔐 Zero-Downtime 마이그레이션

대규모 마이그레이션에서 다운타임 최소화:

### 전략 1: Expand-Contract Pattern

**Phase 1: Expand (확장)**
```python
# Migration 1: 새 컬럼 추가 (nullable)
def upgrade():
    op.add_column('users', sa.Column('new_email', sa.String(255), nullable=True))

# 코드 배포 1: 두 컬럼 모두 지원
# - 읽기: old_email 또는 new_email
# - 쓰기: 둘 다 업데이트

# 데이터 마이그레이션
def upgrade():
    op.execute("UPDATE users SET new_email = old_email WHERE new_email IS NULL")
```

**Phase 2: Contract (축소)**
```python
# Migration 2: 이전 컬럼 제거
def upgrade():
    op.drop_column('users', 'old_email')

# 코드 배포 2: new_email만 사용
```

### 전략 2: Blue-Green Deployment

```yaml
# 두 개의 환경 운영
services:
  - name: mjestimate-blue
    # 현재 버전

  - name: mjestimate-green
    # 새 버전 + 마이그레이션

# 1. Green에 새 버전 배포 + 마이그레이션
# 2. Green 테스트
# 3. 트래픽을 Blue → Green으로 전환
# 4. Blue 종료
```

## 📝 마이그레이션 베스트 프랙티스

### 1. 작은 단위로 나누기

❌ **나쁜 예:**
```python
def upgrade():
    # 10개 테이블 생성
    # 50개 컬럼 변경
    # 복잡한 데이터 마이그레이션
    # 모든 것을 한 번에!
```

✅ **좋은 예:**
```python
# Migration 1: 테이블 추가
def upgrade():
    op.create_table('new_table', ...)

# Migration 2: 데이터 마이그레이션
def upgrade():
    op.execute("INSERT INTO new_table ...")

# Migration 3: 이전 테이블 제거
def upgrade():
    op.drop_table('old_table')
```

### 2. 항상 Downgrade 구현

```python
def upgrade():
    op.add_column('users', sa.Column('phone', sa.String(20)))

def downgrade():
    op.drop_column('users', 'phone')
```

### 3. 데이터 변환 시 배치 처리

```python
def upgrade():
    # 나쁜 예: 한 번에 모든 행 업데이트
    # op.execute("UPDATE users SET ...")  # 100만 행!

    # 좋은 예: 배치로 나누기
    connection = op.get_bind()
    batch_size = 1000
    offset = 0

    while True:
        result = connection.execute(f"""
            UPDATE users SET new_field = old_field
            WHERE id IN (
                SELECT id FROM users
                WHERE new_field IS NULL
                LIMIT {batch_size}
                OFFSET {offset}
            )
        """)

        if result.rowcount == 0:
            break

        offset += batch_size
```

### 4. 인덱스는 CONCURRENTLY

```python
def upgrade():
    # PostgreSQL: 락 없이 인덱스 생성
    op.create_index(
        'ix_users_email',
        'users',
        ['email'],
        postgresql_concurrently=True
    )
```

### 5. Foreign Key는 나중에

```python
# Phase 1: 테이블만 생성 (FK 없이)
def upgrade():
    op.create_table('orders', ...)

# Phase 2: 데이터 입력

# Phase 3: FK 추가
def upgrade():
    op.create_foreign_key(
        'fk_orders_user',
        'orders', 'users',
        ['user_id'], ['id']
    )
```

## 🎯 요약

### 개발 환경
```bash
# 마이그레이션 생성 및 테스트
python sync_db.py
git commit & push
```

### 스테이징/프로덕션
```bash
# 백업
pg_dump $DATABASE_URL > backup.sql

# 배포 (코드 + 마이그레이션)
git pull
python -m alembic upgrade head

# 검증
curl /api/health
```

### 자동화 (CI/CD)
```yaml
# GitHub Actions 또는 Render
# 1. 테스트
# 2. 스테이징 배포 + 마이그레이션
# 3. 프로덕션 배포 + 마이그레이션
# 4. Health check
```

**핵심:** 프로덕션에서는 **절대** `--autogenerate` 하지 않고, 개발 환경에서 만든 마이그레이션을 `upgrade head`로만 적용! 🎯
