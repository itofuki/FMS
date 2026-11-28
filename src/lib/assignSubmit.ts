/* src/lib/assignSubmit.ts
 * LMS（Moodle）の課題に、FMS からファイルで提出する（Open LMS のアプリと同じ Web サービスを使う）。
 *   1. findAssign         : 課題ページの id（cmid）から、課題の設定（id・ファイル数の上限など）を探す（mod_assign_get_assignments）
 *   2. fetchSubmission    : 自分の提出の状態と、提出済みのファイル（mod_assign_get_submission_status）
 *   3. submitFiles        : ファイルを一時置き場（draft）に上げて（webservice/upload.php）、提出として保存する
 *                           （mod_assign_save_submission。「提出」ボタンを押す方式の課題なら mod_assign_submit_for_grading も）。
 *                           Moodle は保存のたびにファイルを丸ごと置き換えるので、残す提出済みのファイルも一緒に上げ直す
 *                           （Open LMS のアプリと同じ）。保存のあと読み直して、状態とファイル名がそろったかで結果を決める
 * LMS の提出に書き込むのは 3 だけ。本人が確認の画面で「提出する」を押したときだけ呼ぶ。
 */
import { LMS_BASE, withLmsToken } from './lms';

export type AssignInfo = {
  id: number;
  cmid: number;
  courseId: number;
  courseName: string;
  name: string;
  /** 提出の受付開始（0 なら指定なし） */
  allowFrom: number;
  duedate: number;
  /** グループで提出する課題か */
  teamSubmission: boolean;
  /** 0 なら上限なし */
  maxFiles: number;
  /** 1 ファイルの上限（バイト。0 ならサイトの上限） */
  maxBytes: number;
  /** 受け付けるファイルの種類（空ならなんでも） */
  fileTypes: string;
  fileEnabled: boolean;
  textEnabled: boolean;
  /** 「提出」ボタンを押して確定する方式か（false なら保存した時点で提出） */
  drafts: boolean;
  requiresStatement: boolean;
};

export type SubmittedFile = { filename: string; fileurl: string; filesize: number };
export type SubmissionState = {
  /** new / draft / submitted / reopened など */
  status: string;
  /** notgraded / graded など */
  gradingStatus: string | null;
  /** グループで提出する課題の、自分のグループの id（なければ null） */
  groupId: number | null;
  canEdit: boolean;
  canSubmit: boolean;
  files: SubmittedFile[];
  timemodified: number | null;
};

export type SubmitDiag = {
  steps: string[];
  warnings: string[];
  expected: string[];
  after: { status: string; files: string[] } | null;
};
export type SubmitResult = { ok: boolean; error: string | null; diag: SubmitDiag };

async function call(token: string, wsfunction: string, params: Record<string, string> = {}): Promise<unknown> {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json', ...params });
  const res = await fetch(`${LMS_BASE}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data && typeof data === 'object' && 'exception' in data) {
    const e = data as { errorcode?: string; message?: string };
    throw new Error(`${e.errorcode}: ${e.message}`);
  }
  return data;
}

type RawConfig = { plugin: string; subtype: string; name: string; value: string };
type RawAssign = {
  id: number; cmid: number; name: string; duedate: number; allowsubmissionsfromdate?: number; teamsubmission?: number;
  submissiondrafts: number; requiresubmissionstatement: number;
  configs?: RawConfig[];
};
type RawCourse = { id: number; fullname: string; assignments?: RawAssign[] };

/** 課題の設定を取り出す（テスト用に分けてある） */
export function toAssignInfo(a: RawAssign, course: { id: number; fullname: string } = { id: 0, fullname: '' }): AssignInfo {
  const cfg = (plugin: string, name: string) => a.configs?.find((c) => c.subtype === 'assignsubmission' && c.plugin === plugin && c.name === name)?.value;
  return {
    id: a.id,
    cmid: a.cmid,
    courseId: course.id,
    courseName: course.fullname,
    name: a.name,
    allowFrom: a.allowsubmissionsfromdate ?? 0,
    duedate: a.duedate,
    teamSubmission: a.teamsubmission === 1,
    maxFiles: Number(cfg('file', 'maxfilesubmissions') ?? 0),
    maxBytes: Number(cfg('file', 'maxsubmissionsizebytes') ?? 0),
    fileTypes: cfg('file', 'filetypeslist') ?? '',
    fileEnabled: cfg('file', 'enabled') === '1',
    textEnabled: cfg('onlinetext', 'enabled') === '1',
    drafts: a.submissiondrafts === 1,
    requiresStatement: a.requiresubmissionstatement === 1,
  };
}

/** 課題ページの URL（…/mod/assign/view.php?id=123）から cmid を取り出す。課題でなければ null */
export function assignCmidFromUrl(url: string | null | undefined): number | null {
  const m = url?.match(/\/mod\/assign\/view\.php\?(?:.*&)?id=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 課題ページの id から、課題の設定を探す（自分のコースの課題をまとめて読む） */
export async function findAssign(token: string, cmid: number): Promise<AssignInfo | null> {
  const data = (await call(token, 'mod_assign_get_assignments')) as { courses?: RawCourse[] };
  for (const c of data.courses ?? []) {
    const a = (c.assignments ?? []).find((x) => x.cmid === cmid);
    if (a) return toAssignInfo(a, c);
  }
  return null;
}

type RawSubmission = {
  status?: string; timemodified?: number;
  plugins?: { type: string; fileareas?: { area: string; files?: { filename: string; fileurl: string; filesize: number }[] }[] }[];
};
type RawStatus = {
  lastattempt?: {
    canedit?: boolean; cansubmit?: boolean; gradingstatus?: string; submissiongroup?: number;
    submission?: RawSubmission;
    /** グループで提出する課題の、グループの提出（こちらが本当の状態。個人の submission は new のまま残ることがある） */
    teamsubmission?: RawSubmission;
  };
};

/** 状態の返事から、状態と提出済みのファイルを取り出す（テスト用に分けてある） */
export function toSubmissionState(raw: RawStatus): SubmissionState {
  const sub = raw.lastattempt?.teamsubmission ?? raw.lastattempt?.submission;
  const files = (sub?.plugins ?? [])
    .filter((p) => p.type === 'file')
    .flatMap((p) => p.fileareas ?? [])
    .filter((f) => f.area === 'submission_files')
    .flatMap((f) => f.files ?? [])
    .map((f) => ({ filename: f.filename, fileurl: f.fileurl, filesize: f.filesize }));
  return {
    status: sub?.status ?? 'new',
    gradingStatus: raw.lastattempt?.gradingstatus ?? null,
    groupId: raw.lastattempt?.submissiongroup || null,
    canEdit: !!raw.lastattempt?.canedit,
    canSubmit: !!raw.lastattempt?.cansubmit,
    files,
    timemodified: sub?.timemodified ?? null,
  };
}

export async function fetchSubmission(token: string, assignId: number): Promise<SubmissionState> {
  return toSubmissionState((await call(token, 'mod_assign_get_submission_status', { assignid: String(assignId) })) as RawStatus);
}

/** 自分のグループの名前（グループで提出する課題のとき。読めなければ null） */
export async function fetchGroupName(token: string, courseId: number, groupId: number): Promise<string | null> {
  try {
    const data = (await call(token, 'core_group_get_course_user_groups', { courseid: String(courseId) })) as { groups?: { id: number; name: string }[] };
    return data.groups?.find((g) => g.id === groupId)?.name ?? null;
  } catch {
    return null;
  }
}

/** ファイルを一時置き場（draft）に上げる。itemid が 0 なら新しい置き場を作り、その番号を返す */
async function uploadToDraft(token: string, itemid: number, file: Blob, filename: string): Promise<number> {
  const fd = new FormData();
  fd.append('token', token);
  fd.append('filearea', 'draft');
  fd.append('itemid', String(itemid));
  fd.append('file_1', file, filename);
  const res = await fetch(`${LMS_BASE}/webservice/upload.php`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]?.itemid) {
    const e = data as { error?: string; errorcode?: string };
    throw new Error(`アップロードに失敗（${filename}）: ${e?.errorcode ?? ''} ${e?.error ?? res.status}`);
  }
  return Number(data[0].itemid);
}

/** 提出のあとの状態が、期待どおりか（状態が提出済み・下書きで、ファイル名がそろっている） */
export function judgeSubmission(after: SubmissionState, expected: string[], drafts: boolean, finalize: boolean): boolean {
  const wantStatus = drafts && !finalize ? ['draft', 'submitted'] : ['submitted'];
  const names = after.files.map((f) => f.filename).sort();
  return wantStatus.includes(after.status) && JSON.stringify(names) === JSON.stringify([...expected].sort());
}

/**
 * 提出する（LMS の提出に書き込む）。keep は残す提出済みのファイル、add は新しいファイル。
 * finalize は「提出」ボタンを押す方式の課題で、確定まで行うか（提出宣言が必要なら、本人が同意したときだけ true にする）
 */
export async function submitFiles(
  token: string, assign: AssignInfo, keep: SubmittedFile[], add: File[], opts: { finalize: boolean; onProgress?: (done: number, total: number) => void },
): Promise<SubmitResult> {
  const diag: SubmitDiag = { steps: [], warnings: [], expected: [...keep.map((f) => f.filename), ...add.map((f) => f.name)], after: null };
  const total = keep.length + add.length;
  let done = 0;
  try {
    let itemid = 0;
    // 残す提出済みのファイルは、LMS から取り出して上げ直す（保存のたびに丸ごと置き換わるため）
    for (const f of keep) {
      const res = await fetch(withLmsToken(f.fileurl, token));
      if (!res.ok) throw new Error(`提出済みのファイルを読めませんでした（${f.filename}）: HTTP ${res.status}`);
      itemid = await uploadToDraft(token, itemid, await res.blob(), f.filename);
      opts.onProgress?.(++done, total);
    }
    for (const f of add) {
      itemid = await uploadToDraft(token, itemid, f, f.name);
      opts.onProgress?.(++done, total);
    }
    diag.steps.push(`upload ${total} files`);
    // ファイルが 1 つもない（すべて外した）ときは、空の置き場で保存する
    if (itemid === 0) {
      const empty = (await call(token, 'core_files_get_unused_draft_itemid')) as { itemid: number };
      itemid = empty.itemid;
    }
    const saved = (await call(token, 'mod_assign_save_submission', {
      assignmentid: String(assign.id),
      'plugindata[files_filemanager]': String(itemid),
    })) as { warning?: string; message?: string; item?: string }[] | null;
    diag.steps.push('save_submission');
    diag.warnings.push(...(Array.isArray(saved) ? saved.map((w) => `${w.warning ?? ''}${w.message ? `: ${w.message}` : ''}`) : []));
    if (assign.drafts && opts.finalize) {
      const fin = (await call(token, 'mod_assign_submit_for_grading', {
        assignmentid: String(assign.id),
        acceptsubmissionstatement: assign.requiresStatement ? '1' : '0',
      })) as { warning?: string; message?: string }[] | null;
      diag.steps.push('submit_for_grading');
      diag.warnings.push(...(Array.isArray(fin) ? fin.map((w) => `${w.warning ?? ''}${w.message ? `: ${w.message}` : ''}`) : []));
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 途中で失敗しても、どこまで反映されたかを読み直して残す
    const after = await fetchSubmission(token, assign.id).catch(() => null);
    diag.after = after && { status: after.status, files: after.files.map((f) => f.filename) };
    return { ok: false, error, diag };
  }
  const after = await fetchSubmission(token, assign.id).catch(() => null);
  diag.after = after && { status: after.status, files: after.files.map((f) => f.filename) };
  const ok = !!after && judgeSubmission(after, diag.expected, assign.drafts, opts.finalize);
  return { ok, error: ok ? null : diag.warnings[0] ?? null, diag };
}
