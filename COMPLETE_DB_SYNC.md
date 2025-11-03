# 완전한 DB 스키마 동기화 가이드

코드 수정으로 인한 **모든** DB 스키마 변경사항을 안전하게 동기화하는 방법입니다.

## 🎯 이 가이드가 해결하는 문제

- ✅ 모든 모델 변경사항 자동 감지 (CompanyCam뿐만 아니라 전체)
- ✅ 누락된 테이블/컬럼 자동 추가
- ✅ 삭제된 테이블/컬럼 안전하게 제거
- ✅ 변경된 컬럼 타입/제약조건 업데이트
- ✅ 안전한 백업 및 롤백 지원

## 🚀 빠른 시작 (권장)

### 방법 1: 자동 동기화 스크립트 (가장 쉬움)

```bash
cd backend

# 대화형 마법사 (권장)
python sync_db.py

# 또는 자동 모드 (프롬프트 없이 바로 적용)
python sync_db.py --auto

# 또는 체크만 (변경사항 확인만)
python sync_db.py --check-only
```

**이 스크립트가 하는 일:**
1. ✅ DB 연결 확인
2. ✅ 현재 상태 표시 (테이블, 버전)
3. ✅ 백업 제안 (PostgreSQL)
4. ✅ 모든 변경사항 자동 감지
5. ✅ 마이그레이션 자동 생성
6. ✅ 적용 전 검토 기회 제공
7. ✅ 마이그레이션 적용
8. ✅ 결과 검증

### 방법 2: 수동 Alembic 명령어

```bash
cd backend

# 1. 현재 상태 확인
.venv\Scripts\python.exe -m alembic current

# 2. 변경사항 자동 감지 및 마이그레이션 생성
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "sync_all_schema_changes"

# 3. 생성된 마이그레이션 검토
# alembic/versions/ 폴더의 최신 파일 열어보기

# 4. 마이그레이션 적용
.venv\Scripts\python.exe -m alembic upgrade head

# 5. 결과 확인
.venv\Scripts\python.exe -m alembic current
```

## 📋 수정 완료 사항

### ✅ alembic/env.py - 모든 모델 import 추가

이제 **모든 26개 모델 파일**이 포함되었습니다:

```python
# Core domains
import app.domains.auth.models
import app.domains.company.models
import app.domains.staff.models

# Document management
import app.domains.document.models
import app.domains.document_types.models
import app.domains.file.models
import app.domains.template.models  # ✅ 추가됨

# Financial
import app.domains.invoice.models
import app.domains.estimate.models
import app.domains.payment.models
import app.domains.payment_config.models
import app.domains.credit.models
import app.domains.receipt.models

# Work orders
import app.domains.work_order.models
import app.domains.water_mitigation.models

# Reports
import app.domains.plumber_report.models
import app.domains.plumber_report.templates.models  # ✅ 추가됨

# Line items (이미 있음)
import app.domains.line_items.models
import app.domains.line_items.category_models

# Construction
import app.domains.reconstruction_estimate.models
import app.domains.pack_calculation.models  # ✅ 추가됨
import app.domains.sketch.models
import app.domains.xactimate.models  # ✅ 추가됨

# Analytics
import app.domains.analytics.models  # ✅ 추가됨

# Material detection (conditional)
import app.domains.material_detection.models
import app.domains.material_detection.training.models  # ✅ 추가됨

# Integrations (conditional)
import app.domains.integrations.models  # ✅ 추가됨
import app.domains.integrations.companycam.models  # ✅ 추가됨
```

### ✅ 새로운 도구: sync_db.py

완전 자동화된 DB 동기화 스크립트:
- 대화형 마법사 모드
- 안전한 백업 생성
- 변경사항 자동 감지
- 적용 전 검토 기회
- 검증 및 확인

## 🔍 현재 DB 상태 확인

### 빠른 체크
```bash
cd backend
python sync_db.py --check-only
```

### 수동 체크
```bash
cd backend

# Alembic 버전
.venv\Scripts\python.exe -m alembic current

# 테이블 목록 (PostgreSQL)
docker exec -it mjestimate-postgres psql -U mjestimate -d mjestimate_dev -c "\dt"

# Python으로 확인
.venv\Scripts\python.exe -c "
from app.core.database_factory import get_database
from sqlalchemy import inspect

db = get_database()
inspector = inspect(db.engine)
tables = inspector.get_table_names()

print(f'Total tables: {len(tables)}')
print('\nAll tables:')
for t in sorted(tables):
    print(f'  - {t}')
"
```

## 🛡️ 안전한 동기화 절차

### 단계별 가이드

#### 1. 백업 (필수!)

**PostgreSQL (Docker):**
```bash
# 자동 백업
docker exec mjestimate-postgres pg_dump -U mjestimate mjestimate_dev > backup_$(date +%Y%m%d_%H%M%S).sql

# 또는 PgAdmin에서 백업
```

**SQLite:**
```bash
# 파일 복사
cp app.db app.db.backup
```

#### 2. 현재 상태 확인

```bash
cd backend
python sync_db.py --check-only
```

출력 예시:
```
==============================================================
                   Current State
==============================================================

ℹ️  Alembic version: 5fa2df040a3d
ℹ️  Total tables: 45

📋 Key tables:
  ✅ companies
  ✅ invoices
  ✅ estimates
  ✅ work_orders
  ✅ water_mitigation_jobs
  ❌ webhook_events
  ❌ companycam_photos
```

#### 3. 변경사항 감지 및 마이그레이션 생성

```bash
# 자동 스크립트 사용 (권장)
python sync_db.py

# 또는 수동
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "sync_all_changes"
```

**Alembic이 감지하는 것들:**
- ✅ 새로운 테이블
- ✅ 삭제된 테이블
- ✅ 새로운 컬럼
- ✅ 삭제된 컬럼
- ✅ 변경된 컬럼 타입
- ✅ 변경된 제약조건 (NULL, DEFAULT, UNIQUE 등)
- ✅ 인덱스 추가/삭제
- ✅ Foreign Key 변경

#### 4. 마이그레이션 검토 (중요!)

생성된 파일을 반드시 확인하세요:
```bash
# 최신 마이그레이션 파일 열기
# alembic/versions/xxxxx_sync_all_changes.py
```

**주의 사항:**
- ⚠️ `op.drop_table()` - 테이블 삭제 (데이터 손실!)
- ⚠️ `op.drop_column()` - 컬럼 삭제 (데이터 손실!)
- ⚠️ `op.alter_column()` - 타입 변경 (데이터 변환 확인 필요)

**수정이 필요한 경우:**
- 마이그레이션 파일을 직접 수정
- 데이터 마이그레이션 로직 추가
- 백업에서 데이터 복원 로직 추가

#### 5. 마이그레이션 적용

```bash
# Dry run (SQL만 출력, 실행 안 함)
.venv\Scripts\python.exe -m alembic upgrade head --sql

# 실제 적용
.venv\Scripts\python.exe -m alembic upgrade head
```

출력 예시:
```
INFO  [alembic.runtime.migration] Running upgrade 5fa2df040a3d -> abc123def456, sync_all_changes
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.ddl.postgresql] Detected sequence named 'companies_id_seq'
INFO  [alembic.ddl.postgresql] Detected index 'ix_companies_name'
```

#### 6. 결과 확인

```bash
# 자동 검증
python sync_db.py --check-only

# 또는 수동
.venv\Scripts\python.exe -m alembic current

# 테이블 확인
.venv\Scripts\python.exe -c "
from app.core.database_factory import get_database
from sqlalchemy import inspect

db = get_database()
inspector = inspect(db.engine)
tables = inspector.get_table_names()

required_tables = [
    'webhook_events', 'companycam_photos',
    'analytics_events', 'pack_calculations'
]

for table in required_tables:
    status = '✅' if table in tables else '❌'
    print(f'{status} {table}')
"
```

## 🔄 일반적인 시나리오

### 시나리오 1: CompanyCam 통합 테이블만 추가

```bash
cd backend
python sync_db.py --auto
```

감지될 내용:
- webhook_events 테이블 생성
- companycam_photos 테이블 생성
- 관련 인덱스 생성

### 시나리오 2: 여러 기능이 추가되어 많은 변경사항

```bash
cd backend

# 1. 현재 상태 확인
python sync_db.py --check-only

# 2. 대화형 동기화 (검토 가능)
python sync_db.py

# 3. 적용 후 백엔드 재시작
cd ..
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 시나리오 3: 컬럼 타입 변경

예: `email` 컬럼을 String(100) → String(255)로 변경

```bash
cd backend

# 마이그레이션 생성
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "increase_email_length"

# 생성된 파일 확인
# alembic/versions/xxxxx_increase_email_length.py
# def upgrade():
#     op.alter_column('users', 'email',
#                     existing_type=sa.String(length=100),
#                     type_=sa.String(length=255))

# 적용
.venv\Scripts\python.exe -m alembic upgrade head
```

### 시나리오 4: 테이블 삭제 (조심!)

```bash
cd backend

# 1. 백업 필수!
docker exec mjestimate-postgres pg_dump -U mjestimate mjestimate_dev > backup_before_drop.sql

# 2. 마이그레이션 생성
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "remove_old_table"

# 3. 생성된 파일 확인
# def upgrade():
#     op.drop_table('old_table')  # ⚠️ 확인 필수!

# 4. 데이터 백업 확인 후 적용
.venv\Scripts\python.exe -m alembic upgrade head
```

## 🆘 문제 해결

### 문제 1: "No changes in schema detected"

**원인:** 모델이 제대로 import되지 않음

**해결:**
```bash
# alembic/env.py 확인
cat alembic/env.py | grep "import app.domains"

# 누락된 모델 있는지 확인
cd backend
python -c "
import sys
from pathlib import Path

# 모든 models.py 파일 찾기
models = list(Path('app/domains').rglob('models.py'))
print(f'Found {len(models)} model files:')
for m in models:
    print(f'  {m}')
"
```

**이미 수정됨:** 모든 26개 모델 파일이 이제 import됩니다!

### 문제 2: "Target database is not up to date"

**원인:** DB 버전이 코드보다 뒤처짐

**해결:**
```bash
cd backend

# 현재 버전 확인
.venv\Scripts\python.exe -m alembic current

# 최신으로 업그레이드
.venv\Scripts\python.exe -m alembic upgrade head
```

### 문제 3: "Can't locate revision identified by 'xxxxx'"

**원인:** 마이그레이션 히스토리가 꼬임

**해결 1: 현재 버전으로 강제 설정**
```bash
cd backend

# 현재 DB 상태를 head로 마크
.venv\Scripts\python.exe -m alembic stamp head
```

**해결 2: DB 재생성 (개발환경만)**
```bash
cd backend
python sync_db.py --force-recreate
# ⚠️ 경고: 모든 데이터 삭제됨!
```

### 문제 4: "Duplicate key" 또는 "Already exists" 에러

**원인:** 테이블/컬럼이 이미 존재

**확인:**
```bash
# 테이블 구조 확인
docker exec -it mjestimate-postgres psql -U mjestimate -d mjestimate_dev -c "\d webhook_events"
```

**해결 방법 1: 마이그레이션 스크립트 수정**
```python
# alembic/versions/xxxxx.py
def upgrade():
    # IF NOT EXISTS 추가
    op.execute("""
        CREATE TABLE IF NOT EXISTS webhook_events (
            ...
        )
    """)
```

**해결 방법 2: 수동으로 테이블 삭제**
```bash
docker exec -it mjestimate-postgres psql -U mjestimate -d mjestimate_dev

DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS companycam_photos CASCADE;
\q
```

그 후 다시 마이그레이션 적용.

### 문제 5: Foreign Key 제약조건 에러

**원인:** 참조하는 테이블이 없거나 데이터 불일치

**확인:**
```bash
docker exec -it mjestimate-postgres psql -U mjestimate -d mjestimate_dev -c "
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'companycam_photos';
"
```

**해결:**
- 참조 테이블이 먼저 생성되도록 마이그레이션 순서 조정
- 또는 FK를 nullable로 설정

### 문제 6: "Invalid datetime format" 마이그레이션 에러

**원인:** 기존 데이터의 datetime 형식 문제

**해결:**
```python
# 마이그레이션 파일에 데이터 변환 로직 추가
def upgrade():
    # 컬럼 타입 변경 전에 데이터 정리
    op.execute("""
        UPDATE webhook_events
        SET created_at = COALESCE(created_at, NOW())
        WHERE created_at IS NULL
    """)

    # 이제 타입 변경
    op.alter_column('webhook_events', 'created_at', ...)
```

## 🔄 롤백 (Downgrade)

마이그레이션을 되돌리기:

```bash
cd backend

# 한 단계 되돌리기
.venv\Scripts\python.exe -m alembic downgrade -1

# 특정 버전으로 되돌리기
.venv\Scripts\python.exe -m alembic downgrade 5fa2df040a3d

# 처음부터 다시
.venv\Scripts\python.exe -m alembic downgrade base
```

**⚠️ 주의:** Downgrade는 데이터 손실 가능!

## 🔥 개발환경 완전 초기화

데이터가 중요하지 않은 개발환경에서:

### 옵션 1: 스크립트 사용
```bash
cd backend
python sync_db.py --force-recreate
# "DELETE ALL DATA" 입력 필요
```

### 옵션 2: Docker 재생성
```bash
# 1. 컨테이너와 볼륨 삭제
docker-compose -f docker-compose.dev.yml down -v

# 2. 재시작
docker-compose -f docker-compose.dev.yml up -d

# 3. 모든 마이그레이션 적용
cd backend
.venv\Scripts\python.exe -m alembic upgrade head

# 4. 초기 데이터 (있는 경우)
.venv\Scripts\python.exe -m app.domains.reconstruction_estimate.seed_materials
```

## 📊 유용한 명령어 모음

```bash
# === Alembic ===
# 현재 버전
python -m alembic current

# 히스토리 보기
python -m alembic history

# 특정 버전 정보
python -m alembic show <revision>

# SQL만 생성 (실행 안 함)
python -m alembic upgrade head --sql

# === Database ===
# PostgreSQL 연결
docker exec -it mjestimate-postgres psql -U mjestimate -d mjestimate_dev

# 테이블 목록
\dt

# 테이블 구조
\d <table_name>

# 인덱스 목록
\di

# Foreign Key 목록
\d+ <table_name>

# === Python ===
# 모든 테이블 목록
python -c "from app.core.database_factory import get_database; from sqlalchemy import inspect; db = get_database(); inspector = inspect(db.engine); print('\n'.join(inspector.get_table_names()))"

# 특정 테이블 컬럼
python -c "from app.core.database_factory import get_database; from sqlalchemy import inspect; db = get_database(); inspector = inspect(db.engine); cols = inspector.get_columns('webhook_events'); print('\n'.join([c['name'] for c in cols]))"
```

## ✅ 완료 체크리스트

동기화 후 확인할 사항:

```bash
cd backend

# 1. Alembic 버전 확인
python -m alembic current
# ✅ (head) 표시 확인

# 2. 테이블 확인
python sync_db.py --check-only
# ✅ 모든 중요 테이블이 존재하는지 확인

# 3. 백엔드 서버 시작
python -m uvicorn app.main:app --reload --port 8000
# ✅ 에러 없이 시작되는지 확인

# 4. Health check
curl http://localhost:8000/api/integrations/health
# ✅ companycam: is_configured: true 확인

# 5. Webhook 테스트 (선택적)
# CompanyCam에서 테스트 사진 업로드
# ✅ DB에 webhook_events, companycam_photos 레코드 생성 확인
```

## 🎯 요약

1. **`python sync_db.py`** - 대화형 마법사 (가장 쉬움)
2. **백업 생성** - 항상 먼저 백업
3. **변경사항 검토** - 생성된 마이그레이션 확인
4. **적용 및 검증** - 마이그레이션 적용 후 확인

이제 **모든 코드 변경사항**이 DB에 안전하게 반영됩니다! 🎉
