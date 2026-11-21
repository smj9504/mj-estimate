---
name: xactimate
description: Use when the user asks to enter an insurance estimate into Xactimate — draw the sketch and fill the line items from a carrier/Xactimate estimate PDF ("/xactimate 6315 Cardinal Hill", "xactimate에 스케치랑 line item 넣어줘", "rebuild만 넣어줘"). Finds the PDF in SimpleWorks by address or customer name (or takes a given file path), creates or reuses the Xactimate X1 desktop project, fills Claim Info (insured name, contact, address, type of loss) and O&P 15/10, sketches every level, enters the line items with PDF quantities, and checks totals against the PDF. Needs computer use and the Xactimate desktop app open.
---

# Xactimate 견적 입력 (PDF → 스케치 + line item)

인자: 주소 또는 손님 이름. PDF 파일 경로가 주어지면 그것을 그대로 쓴다. "rebuild만"이라고 하면 mitigation 항목은 빼고, 그 말이 없으면 PDF의 모든 항목을 넣는다.

사용자가 이 스킬을 부른 것 자체가 아래 작업을 허락한 것이다.
- SimpleWorks에서 해당 PDF를 Downloads에 내려받기.
- 그 PDF 1쪽의 손님 정보를 Xactimate Claim Info 폼에 넣기.

**중간에 묻지 않고 끝까지 한다.** 애매한 곳은 판단해서 진행하고, 판단한 내용은 최종 보고에 적는다. 단, 아래 경우에는 멈추고 묻는다.
- 같은 주소의 클라이언트나 프로젝트가 둘 이상이라 어느 쪽인지 정할 수 없을 때.
- PDF를 찾을 수 없을 때.

## 시작 전 확인
- **Computer use 도구:** 이 세션에 computer-use 도구(`mcp__computer-use__*`)가 있어야 한다. 없으면 Settings → This computer → Computer use를 켜고 새 세션에서 다시 부르라고 안내하고 멈춘다.
- **작업 방법 메모:** 메모리의 `xactimate-x1-sketch-howto`부터 읽는다. 단축키, Dimension Rooms, Break, Staircase, 지연 대처법이 들어 있다.
- **Xactimate 앱 상태:** Xactimate X1 데스크톱 앱이 열려 있어야 한다. 다른 세션이 Xactimate를 조작 중이면 시작하지 않는다. 두 세션이 같은 화면을 만지면 작업이 꼬인다.

## 1. PDF 찾기
1. 파일 경로가 주어졌으면 그 파일을 쓴다.
2. 경로가 없으면 내장 브라우저로 `https://simple-works.vercel.app`을 연다.
   - 로그인 화면이 나오면 사용자에게 로그인해 달라고 요청한다.
   - 클라이언트를 주소나 이름으로 찾는다.
   - 해당 클레임의 Documents에서 Insurance estimate PDF를 찾는다. 리비전이 여러 개면 가장 최신 것을 쓴다.
   - PDF를 Downloads에 받는다.
3. PDF를 페이지별 이미지로 렌더링해서 읽는다. 스캔본처럼 이미지로만 된 PDF가 많다.
   - 도면 페이지: 레벨별 sketch.
   - 1쪽: claim 정보.
   - line item 페이지: 방별 항목, 그리고 방마다 작게 그려진 도면.
4. 노트 폴더에 `<주소>-plan.md`를 쓴다. 들어갈 내용:
   - Claim 정보.
   - 레벨/방별 치수, 문, 창문, missing wall, 계단, 블록.
   - 방별 C/F/W/PF/PC 값.
   - 전체 line item 표: 방 / 설명 / 코드 / act / qty / unit / Calc 추정 / rebuild 또는 mitigation.
   - 방별 RCV 합계와 PDF 총합.

## 2. Xactimate 프로젝트와 Claim Info
- **프로젝트 고르기:** 같은 주소의 프로젝트가 이미 있으면 그것을 쓴다. 없으면 새로 만든다. 다른 프로젝트는 열거나 수정하지 않는다.
- **Claim Info:** 아래 칸만 PDF대로 넣는다(메모리 `xactimate-claim-info-defaults`).
  - Insured Info: 이름, 이메일, Street, City, State, Zip, 전화.
  - Type of Loss: 목록에서 고른다(예: WATER).
  - **비워 둔다:** Deductible($0), Est. Completed, Claim #, Policy #.
- **O&P:** PDF와 상관없이 Parameters → Overhead 15%, Profit 10%, 전체 적용.

## 3. 스케치
- **범위:** PDF의 모든 레벨(Main Level, Level 2, Basement 등)과 방을 그린다. 치수, 문, 창문, missing wall, 계단, 블록(욕조나 캐비닛처럼 면적에서 빠지는 것)까지 포함한다.
- **무시할 표시:** 하늘색 water damage 영역 표시는 무시한다.
- **헷갈릴 때:** 메인 도면이 불분명하면 line item 페이지의 작은 방 도면을 참고한다.
- **치수 맞추기:** 방은 Dimension Rooms 또는 Room 드래그로 그리고, Break로 꺾인 모양을 만든다.
  - 치수가 두 가지 적혀 있으면 면적(C/F)이 PDF와 맞는 쪽을 고른다.
  - 방을 그릴 때마다 C/F/W/PF를 PDF 값과 비교한다.
- **Deduct:** 문과 창문은 Deduct = Yes로 둔다. PDF처럼 W/PF에서 빠지게 하려는 것이다.
- **기본값 복구:** 기본값(문 폭, 계단 폭과 디딤판 등)을 바꿨으면 끝나고 원래대로 돌려놓는다.
- **계단:** 방으로 흉내 내지 말고 Staircase 도구로 그린다. 한 상자 안에 dn/Up 화살표가 여러 개 있으면 계단 하나다(랜딩 포함).

## 4. Line item
- **항목 범위:** 기본은 PDF의 모든 항목이다. "rebuild만"이면 mitigation 항목은 뺀다. 예: 물 빼기, 건조 장비(제습기, 송풍기), 모니터링, 항균 처리, mitigation 철거·청소(주로 WTR).
- **입력 방식:** 각 항목은 PDF와 같은 방에, 같은 코드(CAT/SEL), activity(+, -, &, R), 수량, 단위로 넣는다.
  - 스케치 값과 같은 수량은 Calc 공식(F, W, PF, PC, W-60 등)으로 넣어서 스케치를 따라가게 한다.
  - 그 외 수량은 PDF 숫자를 그대로 넣는다.
- **항목 메모:** PDF에 메모가 붙은 항목은 메모도 넣는다.
- **견적 전체 항목:** Dwelling이나 General처럼 견적 전체에 붙는 항목(mitigation 인보이스, 덤프, 최종 청소 등)도 PDF 위치 그대로 넣는다. 단위가 다르면 PDF에 맞춘다.
- **Labor minimum:** Xactimate가 자동으로 붙인 labor minimum 중 PDF에 없는 것은 해제한다.

## 5. 검증과 보고
1. 방별 합계와 line item 합계(O&P 제외)를 PDF와 비교한다. $5 이상 차이 나는 방은 원인을 찾아 고친다. O&P를 15/10으로 두므로 RCV는 PDF와 달라도 된다.
2. 화면에 "Saved"가 표시됐는지 확인한다.
3. 레벨별 스케치와 방별 항목 목록을 스크린샷으로 찍어 SendUserFile로 보낸다.
4. 이번에 새로 알게 된 Xactimate 조작법이 있으면 `xactimate-x1-sketch-howto` 메모리에 추가한다.
5. 한국어로 보고한다.
   - 레벨별로 그린 방.
   - 방별 항목 수, 우리 금액, PDF 금액을 표로.
   - PDF와 다른 곳.
   - 판단해서 처리한 부분.
   - 넣지 못한 항목이나 정보.
