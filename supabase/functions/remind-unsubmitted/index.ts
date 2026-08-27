// 미작성 팀원 리마인드 메일 발송
//
// 이번 주(월요일 시작, KST 기준) 차주 계획을 아직 저장하지 않은 팀원(role='member')에게
// Resend API로 리마인드 메일을 보낸다. 크론(pg_cron 또는 외부 크론)으로 주기 호출한다.
//
// 필요한 환경변수 (supabase secrets set 으로 등록):
//   RESEND_API_KEY  - Resend API 키
//   MAIL_FROM       - 발신자 주소 (예: onboarding@resend.dev 또는 도메인 인증 후 주소)
//   APP_URL         - 메일 안의 "작성하러 가기" 링크로 쓸 앱 URL
//   CRON_SECRET     - 외부에서 아무나 함수를 호출하지 못하도록 막는 공유 비밀값
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 주입하므로 별도 설정 불필요.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const MAIL_FROM = Deno.env.get('MAIL_FROM') || 'onboarding@resend.dev';
const APP_URL = Deno.env.get('APP_URL') || '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// KST(UTC+9) 기준 이번 주 월요일(YYYY-MM-DD)을 구한다.
function thisWeekStartKST(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kstNow.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(kstNow);
  monday.setUTCDate(kstNow.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret');
    if (provided !== CRON_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const weekStart = thisWeekStartKST();

  const { data: members, error: membersErr } = await sb
    .from('profiles').select('id, name').eq('role', 'member');
  if (membersErr) return json({ error: membersErr.message }, 500);

  const { data: reports, error: reportsErr } = await sb
    .from('reports').select('user_id, saved_at').eq('week_start', weekStart);
  if (reportsErr) return json({ error: reportsErr.message }, 500);

  const submittedIds = new Set(
    (reports || []).filter((r) => r.saved_at).map((r) => r.user_id)
  );
  const unsubmitted = (members || []).filter((m) => !submittedIds.has(m.id));

  if (!unsubmitted.length) {
    return json({ weekStart, sent: 0, message: '전원 작성 완료' });
  }

  const { data: userList, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return json({ error: usersErr.message }, 500);
  const emailById = new Map(userList.users.map((u) => [u.id, u.email]));

  const results = [];
  for (const m of unsubmitted) {
    const email = emailById.get(m.id);
    if (!email) {
      results.push({ name: m.name, ok: false, reason: 'no-email' });
      continue;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: email,
        subject: '[주간보고] 이번 주 차주 계획을 아직 작성하지 않으셨어요',
        html: `
          <p>안녕하세요, ${m.name}님.</p>
          <p>이번 주(${weekStart} 시작) 차주 계획이 아직 저장되지 않았습니다.</p>
          ${APP_URL ? `<p><a href="${APP_URL}">여기를 눌러 작성하러 가기</a></p>` : ''}
        `,
      }),
    });
    results.push({ name: m.name, ok: res.ok, status: res.status });
  }

  return json({
    weekStart,
    sent: results.filter((r) => r.ok).length,
    total: unsubmitted.length,
    results,
  });
});
