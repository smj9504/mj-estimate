# Alembic Migration Best Practices

## 문제: 배포 환경과 로컬 환경의 불일치

배포 환경에는 테이블이 존재하지만 Alembic 버전 테이블에는 기록이 없는 경우, 마이그레이션 실행 시 충돌이 발생합니다.

## 해결 방법

### 방법 1: Alembic 버전 스탬프 (권장) ⭐

배포 환경 데이터베이스가 이미 최신 스키마를 가지고 있다면, Alembic 버전만 업데이트합니다.

```bash
# 로컬에서 (프로덕션 DB URL로)
export DATABASE_URL="your_production_database_url"
cd backend
alembic stamp head

# 또는 스크립트 사용
python scripts/stamp_production_db.py
```

### 방법 2: Idempotent 마이그레이션 작성

각 마이그레이션을 여러 번 실행해도 안전하게 작성합니다.

#### 예시: 컬럼 추가

```python
def upgrade() -> None:
    conn = op.get_bind()
    
    # 컬럼이 이미 존재하는지 확인
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'my_table' AND column_name = 'new_column')"
    ))
    
    if not result.scalar():
        op.add_column('my_table', 
            sa.Column('new_column', sa.String(100), nullable=True)
        )
```

#### 예시: 테이블 생성

```python
def upgrade() -> None:
    conn = op.get_bind()
    
    # 테이블이 이미 존재하는지 확인
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'my_table')"
    ))
    
    if not result.scalar():
        op.create_table(
            'my_table',
            sa.Column('id', sa.UUID(), nullable=False),
            # ... 기타 컬럼
        )
```

#### 예시: 인덱스 생성

```python
def upgrade() -> None:
    conn = op.get_bind()
    
    # 인덱스가 이미 존재하는지 확인
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_indexes "
        "WHERE indexname = 'my_index')"
    ))
    
    if not result.scalar():
        op.create_index('my_index', 'my_table', ['column_name'])
```

#### 예시: ENUM 타입 생성

```python
def upgrade() -> None:
    conn = op.get_bind()
    
    # ENUM이 이미 존재하는지 확인
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_enum')"
    ))
    
    if not result.scalar():
        conn.execute(sa.text(
            "CREATE TYPE my_enum AS ENUM ('VALUE1', 'VALUE2', 'VALUE3')"
        ))
        conn.commit()
```

### 방법 3: 조건부 스키마 변경

테이블이 존재하는 경우에도 스키마 변경사항을 반영합니다.

```python
def upgrade() -> None:
    conn = op.get_bind()
    
    # 테이블 존재 여부 확인
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'my_table')"
    ))
    table_exists = result.scalar()
    
    if not table_exists:
        # 테이블 생성
        op.create_table(
            'my_table',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(100), nullable=False),
            # ... 기타 컬럼
        )
    else:
        # 테이블이 이미 존재하면 필요한 컬럼만 추가
        # 새 컬럼 확인
        result = conn.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'my_table' AND column_name = 'new_field')"
        ))
        
        if not result.scalar():
            op.add_column('my_table',
                sa.Column('new_field', sa.String(50), nullable=True)
            )
    
    # 인덱스는 항상 확인 후 생성
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pg_indexes "
        "WHERE indexname = 'idx_my_table_name')"
    ))
    
    if not result.scalar():
        op.create_index('idx_my_table_name', 'my_table', ['name'])
```

## 배포 프로세스

### 1. 로컬 개발

```bash
# 마이그레이션 생성
alembic revision --autogenerate -m "description"

# 마이그레이션 검토 및 수정 (idempotent하게)
# backend/alembic/versions/xxxxx_description.py 편집

# 로컬 테스트
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

### 2. 프로덕션 배포 전

```bash
# 깨끗한 데이터베이스에서 테스트
# (테스트 DB 생성)
alembic upgrade head

# 문제없으면 커밋
git add backend/alembic/versions/xxxxx_description.py
git commit -m "feat: add migration for..."
git push
```

### 3. 프로덕션 배포 (첫 배포 시)

만약 프로덕션 DB가 이미 최신 스키마를 가지고 있다면:

```bash
# 옵션 A: 직접 stamp
alembic stamp head

# 옵션 B: SQL로 직접 업데이트
# UPDATE alembic_version SET version_num = 'latest_revision_id';
```

### 4. 이후 배포

정상적으로 마이그레이션이 실행됩니다:

```bash
alembic upgrade head
```

## 주의사항

### ❌ 피해야 할 것

1. **프로덕션 DB에서 직접 스키마 수정** - 항상 마이그레이션을 통해
2. **마이그레이션 파일 수정 (배포 후)** - 새 마이그레이션 생성
3. **down_revision 변경** - 마이그레이션 체인 깨짐
4. **여러 환경에서 동시에 autogenerate** - 충돌 발생

### ✅ 권장사항

1. **항상 idempotent하게 작성** - 여러 번 실행해도 안전하게
2. **마이그레이션 테스트** - 깨끗한 DB에서 upgrade/downgrade 테스트
3. **백업** - 프로덕션 마이그레이션 전 백업
4. **점진적 변경** - 한 번에 너무 많은 변경 피하기
5. **트랜잭션 활용** - 가능한 경우 트랜잭션 내에서 실행

## 현재 프로젝트 상황

배포 환경에는 이미 다음 테이블들이 존재:
- `material_detection_jobs`
- `detected_materials`
- `jobstatus` ENUM

따라서 **방법 1 (Alembic Stamp)** 을 사용하는 것을 권장합니다:

```bash
# 프로덕션 DB에 접속하여
alembic stamp b662310f1380  # 최신 revision ID

# 또는 head로
alembic stamp head
```

이후 새로운 마이그레이션은 정상적으로 작동할 것입니다.

