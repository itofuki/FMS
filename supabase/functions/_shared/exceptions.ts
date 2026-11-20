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
  period: number | null;
  start_time: string | null;
  end_time: string | null;
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
 * ある日（date）のいつもの授業（rows のうちその曜日のもの）に、その日のイレギュラーな授業回を当てはめる。
 *   - cancel : その授業（period が空ならその日の全時限）をなくす
 *   - change : 時刻・教室を、入っているものだけ変える（period が空なら全時限。時刻は最初の時限の開始・最後の時限の終了）
 *   - extra  : 補講・振替として授業を足す（同じ時限にいつもの授業があれば置き換える）
 */
export function applyExceptionsForDate<T extends TimetableRowLike>(
  rows: T[], exceptions: ClassException[], date: string,
): (T | TimetableRowLike)[] {
  const wday = wdayOfDate(date);
  let day: (T | TimetableRowLike)[] = rows.filter((r) => r.wday === wday).map((r) => ({ ...r }));
  for (const e of exceptions.filter((x) => x.date === date)) {
    const hits = (r: TimetableRowLike) => r.id === e.course_id && (e.period == null || r.period === e.period);
    if (e.kind === "cancel") {
      day = day.filter((r) => !hits(r));
    } else if (e.kind === "change") {
      const targets = day.filter(hits).sort((a, b) => a.period - b.period);
      targets.forEach((r, i) => {
        r.exception = "change";
        r.exception_note = e.note;
        if (e.classroom) r.classroom = e.classroom;
        // 時限を指定したときはその時限に、全時限のときは最初の時限の開始・最後の時限の終了に当てはめる
        if (e.start_time && (e.period != null || i === 0)) r.start_time = e.start_time;
        if (e.end_time && (e.period != null || i === targets.length - 1)) r.end_time = e.end_time;
      });
    } else if (e.kind === "extra" && e.period != null) {
      const regular = rows.find((r) => r.id === e.course_id);
      day = day.filter((r) => r.period !== e.period);
      day.push({
        id: e.course_id,
        name: e.name,
        wday,
        period: e.period,
        classroom: e.classroom ?? regular?.classroom ?? null,
        teacher: regular?.teacher ?? null,
        attendance_id: e.attendance_id ?? regular?.attendance_id ?? null,
        start_time: e.start_time,
        end_time: e.end_time,
        exception: "extra",
        exception_note: e.note,
      });
    }
  }
  return day.sort((a, b) => a.period - b.period);
}
