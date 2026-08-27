// 대한민국 공휴일 조회
// Nager.Date API(https://date.nager.at)로 실시간 조회하고, 브라우저에 캐시(7일)한다.
// API 조회에 실패하면 아래 하드코딩된 목록으로 대체한다 (연도가 바뀌면 갱신 필요).
const FALLBACK_HOLIDAYS = [
  '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02',
  '2026-05-05','2026-05-24','2026-05-25','2026-06-06','2026-07-17','2026-08-15','2026-08-17',
  '2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25',
  '2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-03-01',
  '2027-05-05','2027-05-13','2027-06-06','2027-06-07','2027-07-17','2027-08-15','2027-08-16',
  '2027-09-14','2027-09-15','2027-09-16','2027-10-03','2027-10-04','2027-10-09','2027-10-11','2027-12-25','2027-12-27',
];

let HOLIDAYS = new Set(FALLBACK_HOLIDAYS);

function isHoliday(ymd) {
  return !!ymd && HOLIDAYS.has(ymd);
}

// years: 조회할 연도 배열. 캐시/폴백과 병합해 HOLIDAYS를 갱신한다.
async function loadHolidays(years) {
  const cacheKey = 'wr_holidays_cache_v1';
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch (e) {}

  const now = Date.now();
  let changed = false;

  await Promise.all([...new Set(years)].map(async (y) => {
    if (cache[y] && (now - cache[y].fetchedAt) < WEEK_MS) return;
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/KR`);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      cache[y] = { dates: data.map(h => h.date), fetchedAt: now };
      changed = true;
    } catch (e) {
      console.warn(`[공휴일] ${y}년 데이터 조회 실패, 기본 목록으로 대체합니다.`, e);
    }
  }));

  if (changed) {
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (e) {}
  }

  const merged = new Set(FALLBACK_HOLIDAYS);
  for (const y of years) {
    if (cache[y]) cache[y].dates.forEach(d => merged.add(d));
  }
  HOLIDAYS = merged;
}
