# 사업부 주간보고

팀원이 매주 실적/계획을 작성하고, 매니저·관리자가 팀 전체 현황을 조회·관리하는 정적 웹 앱입니다.
백엔드 서버 없이 [Supabase](https://supabase.com)(DB·인증)만으로 동작합니다.

## 페이지 구성

| 파일 | 역할 | 접근 권한 |
|---|---|---|
| [login.html](login.html) | 로그인 / 회원가입 | 전체 |
| [index.html](index.html) | 내 주간보고 작성 (금주 실적 / 차주 계획) | 전체 |
| [history.html](history.html) | 내 지난 기록 조회 (주차 이동, 읽기 전용) | 전체 |
| [team.html](team.html) | 팀 전체 보고 조회, 주차 이동, 엑셀 다운로드 | manager, admin |
| [admin.html](admin.html) | 사용자 역할 관리, 리마인드 메일 설정, 과거 데이터 정리 | admin |

## 주요 기능

- **금주 실적 / 차주 계획**: 지난주에 세운 계획이 "금주 실적"으로 자동 표시됩니다. 실제 수행 내용이 계획과 다르면 직접 수정할 수 있고, 수정된 항목은 "수정됨" 배지와 함께 원본 계획과 비교해 볼 수 있습니다 (`report_plans.actual_content`).
- **Markdown 지원**: 계획/실적 내용은 마크다운으로 작성하고 미리보기로 확인할 수 있습니다 ([marked.js](https://marked.js.org)).
- **법정공휴일 표시**: [Nager.Date](https://date.nager.at) 공휴일 API로 해당 날짜를 빨간색으로 표시합니다 (오프라인/실패 시 하드코딩된 목록으로 대체, [js/holidays.js](js/holidays.js)).
- **팀 조회 & 엑셀 다운로드**: 매니저/관리자는 팀원별 보고를 주차별로 조회하고, 팀원 1명당 시트 1개로 구성된 `.xlsx` 파일로 내려받을 수 있습니다. 내용/원래계획 컬럼은 줄바꿈(wrap text)이 적용되어 여러 줄 내용도 그대로 보입니다.
- **역할 관리**: 관리자는 팀원의 이름/역할(팀원·관리자·시스템관리자)을 변경할 수 있습니다.
- **사용자 삭제**: 관리자는 계정을 완전히 삭제할 수 있으며, 그 사용자의 모든 주간보고 데이터도 함께 삭제됩니다 (`supabase/functions/delete-user`).
- **미작성자 리마인드 메일** (선택 기능): 관리자가 설정한 요일/시각에 아직 작성하지 않은 팀원에게 자동으로 메일을 보냅니다. 별도 설정이 필요합니다 — [docs/email-reminder-setup.md](docs/email-reminder-setup.md) 참고.
- **과거 데이터 정리**: 관리자가 특정 주차를 기준으로 그 이전 데이터를 조회 후 삭제할 수 있습니다.

## 기술 스택

- 순수 HTML/JS + [Tailwind CDN](https://tailwindcss.com) (빌드 과정 없음)
- [Supabase](https://supabase.com): Postgres DB, Auth, Edge Functions
- [marked.js](https://marked.js.org): 마크다운 렌더링
- [ExcelJS](https://github.com/exceljs/exceljs): 엑셀 내보내기 (셀 스타일 저장이 필요해 SheetJS 대신 사용)
- [Nager.Date](https://date.nager.at): 공휴일 조회 (무료, 키 불필요)
- Gmail SMTP ([denomailer](https://deno.land/x/denomailer)): 리마인드 메일 발송 (선택 기능)

## 초기 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. Supabase 대시보드 → SQL Editor에서 [supabase-setup.sql](supabase-setup.sql) 전체를 실행합니다. (`profiles`, `reports`, `report_plans`, `system_settings` 테이블과 RLS 정책, 관리자용 함수가 생성됩니다.)
3. [js/config.js](js/config.js)에 프로젝트의 URL과 anon key를 채웁니다.

   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxx';
   ```

4. 정적 파일을 아무 웹 서버(Vercel, Netlify, GitHub Pages 등)에 올립니다. 별도 빌드 단계가 없습니다.
5. [login.html](login.html)에서 회원가입하면 기본적으로 `member` 역할이 부여됩니다. 첫 관리자 계정은 Supabase 대시보드 → Table Editor → `profiles`에서 직접 `role`을 `admin`으로 바꿔주세요. 이후에는 관리자 화면([admin.html](admin.html))에서 역할을 변경할 수 있습니다.

## 선택 기능: 미작성자 리마인드 메일

Gmail SMTP + Supabase Edge Function + pg_cron으로 동작하며, 별도 가입/배포가 필요합니다.
자세한 절차는 [docs/email-reminder-setup.md](docs/email-reminder-setup.md)를 참고하세요.
