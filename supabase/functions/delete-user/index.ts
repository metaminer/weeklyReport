// 사용자 삭제 (관리자 전용)
//
// auth.users에서 사용자를 삭제하면 profiles(ON DELETE CASCADE) → reports(ON DELETE CASCADE)
// → report_plans(ON DELETE CASCADE)까지 연쇄적으로 함께 삭제된다.
// client-side anon key로는 auth.users를 건드릴 수 없어서 이 Edge Function이 필요하다.
//
// 인증: JWT 검증을 켠 채로 배포한다 (--no-verify-jwt 사용하지 않음).
// 그래서 로그인하지 않은 요청은 Supabase 플랫폼이 자동으로 막고, 이 함수 안에서는
// "로그인한 사용자가 실제로 admin 역할인지"만 추가로 확인한다.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 주입한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  // 호출자 신원 확인 (호출자 자신의 JWT로 검증)
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile, error: profileErr } = await admin
    .from('profiles').select('role').eq('id', caller.id).single();
  if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
    return json({ error: 'Forbidden' }, 403);
  }

  let userId: string | undefined;
  try {
    const body = await req.json();
    userId = body?.userId;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!userId) return json({ error: 'userId is required' }, 400);
  if (userId === caller.id) return json({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true });
});
