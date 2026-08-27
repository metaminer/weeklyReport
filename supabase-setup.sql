-- =============================================
-- WeeklyReport 초기화 SQL
-- Supabase SQL Editor 에서 실행하세요
-- =============================================

-- 사용자 프로필
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 신규 Auth 사용자 생성 시 프로필 자동 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'member'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 주간보고 (사용자 × 주차 = 1건)
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,       -- 금주 월요일
  saved_at TIMESTAMPTZ,           -- 마지막 저장일시
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- 차주 계획 항목
CREATE TABLE IF NOT EXISTS report_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  plan_date DATE,
  content TEXT NOT NULL DEFAULT '',       -- 원래 계획 내용
  actual_content TEXT,                    -- 실제 수행 내용 (계획과 다를 때만 값 존재, NULL이면 계획대로 수행)
  actual_updated_at TIMESTAMPTZ,          -- 실적 수정 일시
  sort_order INTEGER DEFAULT 0
);

-- 기존 DB에 이미 report_plans 테이블이 있는 경우 컬럼 추가
ALTER TABLE report_plans ADD COLUMN IF NOT EXISTS actual_content TEXT;
ALTER TABLE report_plans ADD COLUMN IF NOT EXISTS actual_updated_at TIMESTAMPTZ;

-- 시스템 설정 (싱글턴 행 1개만 존재)
CREATE TABLE IF NOT EXISTS system_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reminder_enabled BOOLEAN NOT NULL DEFAULT true,
  reminder_weekday INT NOT NULL DEFAULT 5 CHECK (reminder_weekday BETWEEN 0 AND 6), -- 0=일 ... 6=토
  reminder_hour INT NOT NULL DEFAULT 15 CHECK (reminder_hour BETWEEN 0 AND 23),     -- KST 기준 시
  last_sent_week_start DATE,   -- 이번 주 리마인드를 이미 보냈는지 (중복 발송 방지)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- RLS
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- system_settings: 로그인 사용자는 조회만, 변경은 admin만
CREATE POLICY "settings_select" ON system_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "settings_update" ON system_settings
  FOR UPDATE USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  ) WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- profiles: 로그인 사용자 전체 조회 가능
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- reports: 본인 것 또는 manager/admin 전체 조회
CREATE POLICY "reports_select" ON reports
  FOR SELECT USING (
    auth.uid() = user_id OR
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('manager', 'admin')
  );

CREATE POLICY "reports_insert" ON reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reports_update" ON reports
  FOR UPDATE USING (auth.uid() = user_id);

-- report_plans: 해당 report의 owner 또는 manager/admin
CREATE POLICY "plans_select" ON report_plans
  FOR SELECT USING (
    (SELECT user_id FROM reports WHERE id = report_id) = auth.uid() OR
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('manager', 'admin')
  );

CREATE POLICY "plans_all" ON report_plans
  FOR ALL USING (
    (SELECT user_id FROM reports WHERE id = report_id) = auth.uid()
  ) WITH CHECK (
    (SELECT user_id FROM reports WHERE id = report_id) = auth.uid()
  );

-- =============================================
-- 관리자 역할/이름 변경 함수 (RLS 우회)
-- =============================================
CREATE OR REPLACE FUNCTION update_user_profile(
  target_id UUID,
  new_name TEXT DEFAULT NULL,
  new_role TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE profiles
  SET
    name = COALESCE(new_name, name),
    role = COALESCE(new_role, role)
  WHERE id = target_id;
END;
$$;
