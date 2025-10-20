# MJ Estimate - Deployment Guide

## WeasyPrint Dependencies

이 애플리케이션은 PDF 생성을 위해 WeasyPrint를 사용합니다. WeasyPrint는 플랫폼별로 다른 설정이 필요합니다.

### Development (Windows)

Windows 개발 환경에서는 GTK3 Runtime이 로컬에 설치되어 있어야 합니다:
- GTK3-Runtime Win64를 `C:\Program Files\GTK3-Runtime Win64`에 설치
- `pdf_service.py`가 자동으로 GTK 경로를 PATH에 추가

### Production (Docker/Linux)

Docker 환경에서는 시스템 패키지로 필요한 라이브러리가 설치됩니다:

```dockerfile
# Dockerfile에 포함된 WeasyPrint 의존성
libpango-1.0-0        # Text rendering
libpangocairo-1.0-0   # Cairo integration
libgdk-pixbuf2.0-0    # Image support
libffi-dev            # Foreign function interface
shared-mime-info      # MIME type detection
```

## Docker Deployment

### 1. 환경 변수 설정

Production 환경 변수 파일 확인:
```bash
# backend/.env.production 파일 확인
ENVIRONMENT=production
SUPABASE_URL=your-production-url
SUPABASE_KEY=your-production-key
```

### 2. Docker Build & Run

전체 스택 실행:
```bash
# Production 빌드 및 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 중지
docker-compose down
```

개별 서비스 빌드:
```bash
# Backend만 빌드
docker build -t mjestimate-backend ./backend

# Backend 실행
docker run -p 8000:8000 \
  --env-file ./backend/.env.production \
  mjestimate-backend
```

### 3. WeasyPrint 작동 확인

컨테이너 내부에서 WeasyPrint 테스트:
```bash
# 컨테이너 접속
docker exec -it mjestimate-backend bash

# Python에서 테스트
python -c "from weasyprint import HTML; print('WeasyPrint OK')"
```

## Platform Detection

`pdf_service.py`는 자동으로 플랫폼을 감지합니다:

```python
# Windows 개발 환경: GTK 경로 추가
if sys.platform == 'win32' and os.environ.get('ENVIRONMENT', 'development') == 'development':
    gtk_path = r"C:\Program Files\GTK3-Runtime Win64\bin"
    # GTK PATH 설정...

# Linux/Docker: 시스템 패키지 사용 (추가 설정 불필요)
```

## Troubleshooting

### PDF 생성 실패

**증상**: "OSError: cannot load library 'gobject-2.0-0'"

**해결**:
1. Docker에서 실행 중인지 확인
2. Dockerfile에 WeasyPrint 의존성이 포함되어 있는지 확인
3. 컨테이너 재빌드: `docker-compose build --no-cache`

### 한글 폰트 문제

**증상**: PDF에서 한글이 깨짐

**해결**:
```dockerfile
# Dockerfile에 한글 폰트 추가
RUN apt-get update && apt-get install -y \
    fonts-nanum \
    fonts-nanum-coding \
    && fc-cache -f -v
```

## Cloud Deployment

### AWS ECS / Fargate
- Docker 이미지를 ECR에 푸시
- Task Definition에서 환경 변수 설정
- WeasyPrint 의존성은 Docker 이미지에 포함됨

### Google Cloud Run
- 동일한 Dockerfile 사용
- Cloud Run은 자동으로 컨테이너화된 앱 실행
- 메모리 제한: 최소 512MB 권장 (PDF 생성용)

### Heroku
- heroku.yml 또는 Dockerfile 사용
- Buildpack: heroku/python
- WeasyPrint dependencies: Apt buildpack 사용

```yaml
# heroku.yml 예시
build:
  docker:
    web: backend/Dockerfile
```

## Performance Considerations

- PDF 생성은 CPU/메모리 집약적
- Production: 최소 512MB RAM, 1 CPU core 권장
- 대량 PDF 생성: 별도 워커 프로세스 또는 큐 시스템 고려
