# 미작성자 리마인드 메일 설정 가이드

매주 정해진 시각에, 그 주의 차주 계획을 아직 저장하지 않은 팀원에게 자동으로 메일을 보내는 기능입니다.
코드는 [supabase/functions/remind-unsubmitted/index.ts](../supabase/functions/remind-unsubmitted/index.ts)에 있습니다.

브라우저에 아무도 접속해 있지 않아도 동작해야 하므로, Supabase Edge Function(서버리스 함수) + 스케줄러 조합으로 구현합니다.

## 1. Resend 가입 및 API 키 발급

1. https://resend.com 에서 가입합니다.
2. 대시보드 → API Keys → Create API Key 로 키를 발급받습니다. (`re_...` 형태)
3. (선택, 실서비스용) Domains 메뉴에서 본인 도메인을 인증하면 `noreply@본인도메인.com` 같은 주소로 발송할 수 있습니다.
   - 도메인 인증 없이 테스트만 할 경우 `MAIL_FROM=onboarding@resend.dev`로 두면 되지만, 이 경우 **가입한 본인 이메일로만** 발송 테스트가 가능합니다 (Resend 정책).

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
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set MAIL_FROM=onboarding@resend.dev
supabase secrets set APP_URL=https://your-app-url.example.com
supabase secrets set CRON_SECRET=아무렇게나-정한-긴-문자열
```

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
- 로직을 바꾸고 싶으면 `index.ts`를 수정 후 4번 배포 명령을 다시 실행하면 됩니다.
