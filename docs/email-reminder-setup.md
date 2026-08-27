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

## 6. 스케줄 등록 (매주 자동 실행)

### 방법 A — Supabase `pg_cron` (권장, 외부 서비스 불필요)

Supabase 대시보드 → Database → Extensions 에서 `pg_cron`과 `pg_net`을 활성화한 뒤,
SQL Editor에서 아래를 실행합니다 (매주 금요일 15:00 KST = 06:00 UTC 예시):

```sql
select cron.schedule(
  'weekly-report-reminder',
  '0 6 * * 5',
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

시간을 바꾸고 싶으면 `'0 6 * * 5'`(cron 표현식, UTC 기준)를 수정하세요. 예: 매주 목요일 17:00 KST → `'0 8 * * 4'`.

등록된 스케줄 확인/삭제:

```sql
select * from cron.job;
select cron.unschedule('weekly-report-reminder');
```

### 방법 B — 외부 무료 크론(cron-job.org 등)

pg_cron을 쓰지 않으려면 https://cron-job.org 같은 무료 서비스에서 아래처럼 등록해도 됩니다.

- URL: `https://<프로젝트-ref>.supabase.co/functions/v1/remind-unsubmitted`
- Method: POST
- Header: `x-cron-secret: 아무렇게나-정한-긴-문자열`
- 주기: 매주 원하는 요일/시각

## 참고

- "저장 여부" 판단 기준은 `reports.saved_at` 값이 있는지입니다 (앱에서 "저장" 버튼을 눌러야 채워짐).
- 메일 대상은 `profiles.role = 'member'`인 사용자만입니다. 매니저/관리자는 제외됩니다.
- 로직을 바꾸고 싶으면(예: 매니저에게도 요약 발송) `index.ts`를 수정 후 3번 배포 명령을 다시 실행하면 됩니다.
