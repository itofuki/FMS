// supabase/functions/_shared/exceptions.ts
// イレギュラーな授業回（休講・時刻や教室の変更・補講）を、ある日のいつもの時間割に当てはめる（純粋関数のみ。Deno / Vitest の両方から読み込める）。
// 授業前の通知とカレンダー連携で使う。画面側は src/lib/classExceptions.ts が同じ考え方で当てはめる。

/** get_class_exceptions の 1 行 */
export type ClassException = {
  id: number;
  course_id: number;
  name: string;
  date: string; // YYYY-MM-DD
  kind: "change" | "cancel" | "extra";
  /** その日の授業の時限（変更: 動かした先も含めたその日の時限 / 休講: 休む時限 / 補講: 足す時限）。空なら既定値の時限すべて */
  periods: number[] | null;
  /** 時限ごとの時刻（既定値と違う時限だけ） */
  period_times: Record<string, { start?: string; end?: string }> | null;
  classroom: string | null;
  note: string | null;
  attendance_id: number | null;
};

/** 時間割の 1 行（get_effective_timetable と同じ形） */
export type TimetableRowLike = {
  id: number;
  name: string;
  wday: string;
  period: number;
  classroom: string | null;
  teacher?: string | null;
  attendance_id?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  /** イレギュラーな授業回で変わった・足されたもの（当てはめた結果にだけ付く） */
  exception?: "change" | "extra";
  /** イレギュラーな授業回のメモ */
  exception_note?: string | null;
};

const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** YYYY-MM-DD の曜日（Mon など） */
export function wdayOfDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * ある日（date）のいつもの授業（rows のうちその曜日のもの）に、その日のイレギュラーな授業回を当てはめる（1 つの授業・1 日につき 1 件）。
 *   - cancel : その授業の、periods の時限（空ならその日の全時限）をなくす
 *   - change : その日のその授業を、periods の時限（空ならいつもの時限のまま）に置き換える。
 *              時刻は period_times にある時限だけ変え、ない時限はいつもの時刻（いつもない時限なら本来の時刻）。教室は入っていれば変える
 *   - extra  : 補講・振替として periods の時限に授業を足す（同じ時限にほかの授業があれば置き換える）
 */
export function applyExceptionsForDate<T extends TimetableRowLike>(
  rows: T[], exceptions: ClassException[], date: string,
): (T | TimetableRowLike)[] {
  const wday = wdayOfDate(date);
  let day: (T | TimetableRowLike)[] = rows.filter((r) => r.wday === wday).map((r) => ({ ...r }));
  for (const e of exceptions.filter((x) => x.date === date)) {
    const mine = day.filter((r) => r.id === e.course_id);
    const anyRegular = mine[0] ?? rows.find((r) => r.id === e.course_id);
    const timeOf = (p: number, key: "start" | "end") => e.period_times?.[String(p)]?.[key] || null;
    if (e.kind === "cancel") {
      day = day.filter((r) => !(r.id === e.course_id && (e.periods == null || e.periods.includes(r.period))));
    } else if (e.kind === "change" || e.kind === "extra") {
      const periods = e.periods ?? mine.map((r) => r.period);
      // 変更はその日のその授業をすべて置き換える。補講は足す時限にあるほかの授業も置き換える
      day = day.filter((r) => !(e.kind === "change" && r.id === e.course_id) && !periods.includes(r.period));
      for (const p of periods) {
        const same = mine.find((r) => r.period === p);
        day.push({
          id: e.course_id,
          name: anyRegular?.name ?? e.name,
          wday,
          period: p,
          classroom: e.classroom ?? anyRegular?.classroom ?? null,
          teacher: anyRegular?.teacher ?? null,
          attendance_id: e.attendance_id ?? anyRegular?.attendance_id ?? null,
          start_time: timeOf(p, "start") ?? same?.start_time ?? null,
          end_time: timeOf(p, "end") ?? same?.end_time ?? null,
          exception: e.kind,
          exception_note: e.note,
        });
      }
    }
  }
  return day.sort((a, b) => a.period - b.period);
}
