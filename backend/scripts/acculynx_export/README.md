# AccuLynx 전체 데이터 이전 → Google 공유 드라이브 + Google Sheet

AccuLynx 해지 전에 모든 데이터를 가져오는 일회성 스크립트입니다.
앱(mj-estimate) 코드와 분리되어 있고, 로컬 PC에서 실행합니다.

## 무엇을 어디서 가져오나

| 데이터 | 가져오는 방법 |
|---|---|
| Job, Contact, 보험(Insurance/Adjuster), 담당자, 커스텀 필드, Estimate(항목까지), Financials/Worksheet/Amendment, Invoice, Payment, Supplement, 마일스톤 이력, Job/Lead History, 캘린더 일정, 사용자, 회사 설정 | **AccuLynx API** (`collect`) |
| **Communications** (문자, 이메일, 고객 포털, 크루 메시지, 통화 기록, 노트), **Photos & Videos**, **Documents** | API에 조회 기능이 없음 → **AccuLynx 웹을 브라우저로 열어서 캡처** (`web-capture`) |

## 결과물

```
<공유 드라이브>/AccuLynx Archive/
├── AccuLynx Archive            ← Google Sheet
├── _raw_json/acculynx_raw_<날짜>.zip    ← 원본 JSON 전체 백업
└── Jobs/<Job #> - <Job Name>/
    ├── Photos & Videos/
    ├── Documents/<AccuLynx 문서 폴더>/
    ├── Communications/                  ← 메시지 첨부파일
    └── acculynx_job_data.json           ← 이 Job의 API 데이터 전체
```

### Google Sheet 탭 (AccuLynx Job 화면 구성 기준)

모든 Job 관련 탭은 `Job ID / Job # / Job Name` 컬럼으로 시작하므로 필터로 Job별 조회가 됩니다.

| 탭 | 내용 |
|---|---|
| Summary | 내보낸 시각, 드라이브 링크, 탭별 행 수 |
| **Jobs** | Job 개요: 마일스톤/상태, 주소, 카테고리/Work Type/Trade, 리드 소스, 담당자, 첫 약속, 보험사·Claim #, 금액, **Drive 폴더 링크**, 사진/문서/메시지 수 |
| **Contacts** | 고객 정보: 이름, 회사, 이메일/전화 전체, 주소(우편/청구), 연결된 Job, 커스텀 필드 |
| Job Contacts | Job ↔ Contact 연결 (Primary 여부, 관계) |
| **Insurance** | 보험사, Claim #, Date of Loss, 피해 위치, Claim 접수/승인, Adjuster 연락처·미팅 |
| Representatives | Job 담당자 (Company Rep, Sales Owner, A/R Owner 등) |
| Custom Fields | Job·Contact 커스텀 필드 값 |
| **Communications** | 날짜, 채널(문자/이메일/포털 등), 방향, 보낸 사람, 받는 사람, 제목, 본문, 스레드, 첨부파일 **Drive 링크** |
| **Photos & Videos** | 파일명, 태그/앨범, 날짜, **Drive 링크/경로** |
| **Documents** | AccuLynx 폴더, 파일명, 날짜, **Drive 링크/경로** (메시지 첨부파일 포함) |
| Estimates / Estimate Items | 견적서, 섹션별 항목(수량·단위·자재비·인건비·금액) |
| Financials / Worksheet Items | 승인 금액, 잔액, 워크시트 합계, 워크시트/Amendment 항목 |
| Invoices / Invoice Items | 인보이스와 항목 |
| Payments | 받은 돈 / 지급한 돈 / 추가 비용 |
| Supplements / Supplement Items / Supplement Notes | 보험 추가 청구 |
| Milestone History / Job History | 마일스톤 변경 이력, Job/Lead 활동 기록 |
| Appointments | 캘린더 일정 |
| Users / Company Settings | 사용자, 리드 소스, Trade/Work Type, 문서 폴더 등 설정값 |

## 준비

1. **Python 패키지** (backend 가상환경에서)
   ```bat
   cd backend
   .venv\Scripts\activate
   pip install -r scripts\acculynx_export\requirements.txt
   playwright install chromium
   ```
2. **Google 서비스 계정**
   - Google Cloud 프로젝트에서 **Google Drive API**와 **Google Sheets API**를 사용 설정합니다.
   - 서비스 계정 키(JSON)를 받고, 그 서비스 계정 이메일을 **공유 드라이브 멤버(콘텐츠 관리자)**로 추가합니다.
3. **`backend/.env`에 추가** (값은 채팅이나 커밋에 넣지 마세요)
   ```
   ACCULYNX_API_KEY=...                            # my.acculynx.com/apikeys
   ACCULYNX_EXPORT_SERVICE_ACCOUNT_FILE=secrets/xxx.json
   ACCULYNX_EXPORT_SHARED_DRIVE_ID=...             # 공유 드라이브 URL의 folders/ 뒤 ID
   # 선택
   ACCULYNX_EXPORT_PARENT_FOLDER_ID=               # 공유 드라이브 안의 특정 폴더에 넣을 때
   ACCULYNX_EXPORT_DIR=acculynx_export_data        # 로컬 작업 폴더 (git 제외됨)
   ACCULYNX_EXPORT_START_DATE=2010-01-01           # 이 날짜 이후 생성된 Job부터
   ```

## 실행 순서 (backend 폴더에서)

```bat
:: 0. 연결 확인
python -m scripts.acculynx_export check

:: 1. API 데이터 수집 - 먼저 5건으로 테스트, 확인 후 전체
python -m scripts.acculynx_export collect --limit 5
python -m scripts.acculynx_export build-sheet --local-only   :: CSV 미리보기 (acculynx_export_data\sheet_preview)
python -m scripts.acculynx_export collect

:: 2. AccuLynx 웹 로그인 (브라우저가 열리면 직접 로그인, MFA 가능)
python -m scripts.acculynx_export web-login

:: 3. 페이지 구조 확인 (Job 1건) - 브라우저에서 Communications의 모든 채널/스레드,
::    Photos & Videos, Documents 탭을 직접 클릭하고 끝까지 스크롤한 뒤 Enter
python -m scripts.acculynx_export web-discover --job-id <JobID>
::    → acculynx_export_data\raw\web\_discovery\<JobID>_summary.json 을 개발자에게 전달
::    → 확인된 실제 주소로 web_pages.json 작성 (web_pages.example.json 참고)

:: 4. Communications / 사진 / 문서 캡처 - 테스트 후 전체
python -m scripts.acculynx_export web-capture --limit 3 --show-browser
python -m scripts.acculynx_export web-capture

:: 5. 공유 드라이브 업로드 → Google Sheet 생성
python -m scripts.acculynx_export upload
python -m scripts.acculynx_export build-sheet

:: 6. 검증 (API Job 수 vs 저장/업로드 수, 실패 목록)
python -m scripts.acculynx_export verify
```

- 모든 단계는 **중간에 끊겨도 다시 실행하면 이어서** 진행합니다 (이미 받은/올린 것은 건너뜀). 처음부터 다시 받으려면 `--refresh`.
- AccuLynx API는 초당 10회 제한이라 초당 8회로 요청합니다. Job 1건당 약 20~40회 호출 → Job 1,000건이면 약 1~1.5시간.
- 로그는 `acculynx_export_data\export.log`에 남습니다.

## 주의

- **AccuLynx 해지 전에 6단계 검증까지 끝내야 합니다.** 해지 후에는 API 키와 웹 로그인이 모두 막힙니다.
- `web-capture`의 Communications 파싱은 일반적인 필드명(body/message/from/to/createdDate…)으로 작성되어 있습니다.
  3단계 결과를 보고 AccuLynx 실제 필드명에 맞게 `sheet_builder.py`의 `_communication_rows`를 확정해야 합니다.
- Google Sheet 한 파일은 최대 1,000만 셀입니다. 넘으면 오류 메시지가 나오고, 그때 큰 탭(Communications 등)을 별도 파일로 분리합니다.
