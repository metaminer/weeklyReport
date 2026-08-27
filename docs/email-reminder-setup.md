# 미작성자 리마인드 메일 설정 가이드

매주 정해진 시각에, 그 주의 차주 계획을 아직 저장하지 않은 팀원에게 자동으로 메일을 보내는 기능입니다.
코드는 [supabase/functions/remind-unsubmitted/index.ts](../supabase/functions/remind-unsubmitted/index.ts)에 있습니다.

브라우저에 아무도 접속해 있지 않아도 동작해야 하므로, Supabase Edge Function(서버리스 함수) + 스케줄러 조합으로 구현합니다.

## 1. Gmail 앱 비밀번호 발급

발송 전용 Gmail 계정(개인 `@gmail.com` 또는 Google Workspace 계정 모두 가능)을 하나 준비합니다.

1. 그 계정에 [2단계 인증](https://myaccount.google.com/security)을 켭니다 (앱 비밀번호는 2단계 인증이 켜져 있어야 발급 가능).
2. [Google 계정 → 보안 → 앱 비밀번호](https://myaccount.google.com/apppasswords)에서 새 앱 비밀번호를 발급받습니다 (이름은 아무거나, 예: "주간보고"). 16자리 문자열이 생성됩니다.
3. 도메인 인증, 사업자등록, 관리자 승인 모두 필요 없습니다.
4. 발송 한도: 개인 Gmail은 하루 500통, Workspace 계정은 하루 2,000통 — 팀 리마인드 용도로는 충분합니다.

## 2. Supabase CLI 설치 및 로그인

```bash
npm install -g supabase
supabase login
```

프로젝트 루트(`C:\workspace\WeeklyReportProject`)에서:

```bash
supabase link --project-ref <프로젝트-ref>
```

`<프로젝트-ref>`는 Supabase 대시보드 URL에서 확인할 수 있습니다 (`https://supabase.com/dashboard/project/여기부분`).

## 3. 환경변수(시크릿) 등록

```bash
supabase secrets set GMAIL_USER=yourname@gmail.com
supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
supabase secrets set APP_URL=https://your-app-url.example.com
supabase secrets set CRON_SECRET=아무렇게나-정한-긴-문자열
```

`GMAIL_APP_PASSWORD`는 1번에서 발급받은 16자리 앱 비밀번호를 공백 없이 그대로 넣습니다.

- `CRON_SECRET`은 아무나 함수 URL을 호출해서 메일을 남발하지 못하도록 막는 값입니다. 원하는 임의의 긴 문자열로 정하세요.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동으로 주입하므로 따로 설정할 필요가 없습니다.

## 4. 함수 배포

```bash
supabase functions deploy remind-unsubmitted --no-verify-jwt
```

`--no-verify-jwt`가 필요한 이유: 이 함수는 브라우저가 아니라 크론이 호출하므로 Supabase 로그인 JWT 대신 위에서 설정한 `CRON_SECRET` 헤더로 인증합니다.

## 5. 배포 확인 (수동 테스트)

```bash
curl -X POST "https://<프로젝트-ref>.supabase.co/functions/v1/remind-unsubmitted" \
  -H "x-cron-secret: 아무렇게나-정한-긴-문자열"
```

`{"weekStart":"2026-08-24","sent":0,"message":"전원 작성 완료"}` 같은 JSON이 오면 정상입니다.
테스트 계정이 아직 이번 주를 저장하지 않은 상태라면 실제로 메일이 발송됩니다.

## 6. 크론 등록 (매시 정각 호출)

발송 요일/시각 자체는 **DB의 `system_settings` 테이블 값**으로 제어합니다 (아래 7번, 관리자 화면에서 수정).
그래서 크론은 "정확한 그 시각"이 아니라 **매시 정각마다** 함수를 호출하기만 하면 되고,
함수 안에서 지금이 설정된 요일/시각인지, 이번 주에 이미 보냈는지를 확인한 뒤에만 실제로 발송합니다.

### 방법 A — Supabase `pg_cron` (권장, 외부 서비스 불필요)

Supabase 대시보드 → Database → Extensions 에서 `pg_cron`과 `pg_net`을 활성화한 뒤,
SQL Editor에서 아래를 실행합니다:

```sql
select cron.schedule(
  'weekly-report-reminder',
  '0 * * * *',   -- 매시 정각
  $$
  select net.http_post(
    url := 'https://<프로젝트-ref>.supabase.co/functions/v1/remind-unsubmitted',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '아무렇게나-정한-긴-문자열'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

등록된 스케줄 확인/삭제/수정:

```sql
select * from cron.job;
select cron.unschedule('weekly-report-reminder');
select cron.alter_job(job_id := 1, schedule := '0 * * * *');
```

### 방법 B — 외부 무료 크론(cron-job.org 등)

pg_cron을 쓰지 않으려면 https://cron-job.org 같은 무료 서비스에서 아래처럼 등록해도 됩니다.

- URL: `https://<프로젝트-ref>.supabase.co/functions/v1/remind-unsubmitted`
- Method: POST
- Header: `x-cron-secret: 아무렇게나-정한-긴-문자열`
- 주기: 매시 정각 (`0 * * * *`)

## 7. 발송 요일/시각 설정 (관리자 화면)

관리자 계정으로 로그인 → 관리자 아이콘 → **시스템 설정 — 미작성자 리마인드 메일** 섹션에서:

- 발송 사용 여부(토글)
- 요일 (일~토)
- 시각 (한국 시간 기준 0~23시)

를 설정하고 저장하면, 다음 매시 정각 크론 실행부터 바로 반영됩니다. pg_cron 스케줄을 다시 건드릴 필요는 없습니다.

같은 주에 이미 발송했다면 `system_settings.last_sent_week_start`에 그 주의 월요일 날짜가 기록되어
중복 발송되지 않습니다 (다음 주가 되면 자동으로 다시 보낼 수 있는 상태가 됨).

## 참고

- "저장 여부" 판단 기준은 `reports.saved_at` 값이 있는지입니다 (앱에서 "저장" 버튼을 눌러야 채워짐).
- 메일 대상은 `profiles.role = 'member'`인 사용자만입니다. 매니저/관리자는 제외됩니다.
- `?force=true` 쿼리 파라미터를 붙여 호출하면 요일/시각/중복 체크를 건너뛰고 즉시 발송합니다 (수동 테스트용). `last_sent_week_start`도 갱신하지 않습니다.
- `?test=이메일주소` 를 붙여 호출하면 미작성자 조회 없이 그 주소로 테스트 메일 1건만 보냅니다 (SMTP 설정 확인용).
- 로직을 바꾸고 싶으면 `index.ts`를 수정 후 4번 배포 명령을 다시 실행하면 됩니다.

### ⚠️ denomailer의 한글(멀티바이트) 인코딩 버그 — 이미 우회 처리됨

사용 중인 `denomailer` 라이브러리는 quoted-printable로 인코딩할 때 74자마다 줄바꿈(`=\r\n`)을 넣는데,
이게 멀티바이트(한글 등) 문자의 바이트 경계를 무시하고 잘라서 넣습니다. 두 군데에서 문제가 됐습니다.

1. **제목(Subject)**: 인코딩된 제목이 74자를 넘으면 RFC 2047 인코딩된-단어 안에 불법 줄바꿈이 생겨
   메일 헤더 전체가 깨지고, 일부 메일 클라이언트(사내 Exchange/Outlook 등)가 메일 구조를 아예 못 읽고
   원본 MIME 텍스트를 그대로 보여줬습니다. → **`subject`는 항상 영문(ASCII)으로 고정**해서 이 경로 자체를 피합니다.
2. **본문(HTML)**: 같은 이유로 본문 중 특정 한글 단어(예: "작성")가 중간에 깨져서 도착했습니다.
   → 본문은 `html` 필드 대신 `mimeContent`에 **base64로 직접 인코딩**해서 전달합니다
   (`toBase64Lines()` 함수, `reminderEmail()` 참고). base64는 4글자 단위로만 줄바꿈되어
   UTF-8 문자 중간이 잘릴 일이 없습니다.

두 문제 모두 실제 사내 메일함으로 재현·검증했고 현재는 정상 발송됩니다.
메일 템플릿(제목/본문)을 수정하려면 `index.ts`의 `reminderEmail()` 함수만 고치면 되고,
**본문은 한글로 자유롭게 써도 되지만 제목은 계속 영문으로 유지**해야 합니다.
