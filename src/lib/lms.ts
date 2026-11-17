/* src/lib/lms.ts
 * LMS(Moodle)連携のクライアント側ユーティリティ。
 *
 * セキュリティ方針:
 *   - LMSのパスワードはブラウザに保存しない。初回の接続時に一度だけ Edge Function に送り、
 *     返ってきた Moodle のトークンのみを保存する。
 *   - トークンを含むURLはキャッシュ(localStorage)に保存しない。添付ファイルを開く直前に付与する。
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { clearLmsIssue } from './lmsStatus';

export const LMS_BASE = 'https://lms-tokyo.iput.ac.jp';

const KEY_USERNAME = 'fms_lms_username';
const KEY_TOKEN = 'fms_lms_token';
const KEY_USERID = 'fms_lms_userid';
// 旧バージョンが保存していたキー（移行時に削除する）
const LEGACY_KEYS = ['fms_lms_password', 'fms_lms_mfa_secret'];

export type LmsSession = { username: string; token: string; userId: number };

const safeGet = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

/** 旧バージョンで平文保存されていたパスワード等を削除する */
export const purgeLegacyLmsSecrets = () => {
  try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* noop */ }
};

export const getLmsSession = (): LmsSession | null => {
  const username = safeGet(KEY_USERNAME);
  const token = safeGet(KEY_TOKEN);
  const userId = Number(safeGet(KEY_USERID));
  if (!username || !token || !userId) return null;
  return { username, token, userId };
};

export const saveLmsSession = (s: LmsSession) => {
  localStorage.setItem(KEY_USERNAME, s.username);
  localStorage.setItem(KEY_TOKEN, s.token);
  localStorage.setItem(KEY_USERID, String(s.userId));
  purgeLegacyLmsSecrets();
  clearLmsIssue();
};

export const clearLmsSession = () => {
  const username = safeGet(KEY_USERNAME);
  [KEY_USERNAME, KEY_TOKEN, KEY_USERID, ...LEGACY_KEYS].forEach((k) => localStorage.removeItem(k));
  if (username) {
    localStorage.removeItem(lmsEventsCacheKey(username));
    localStorage.removeItem(lmsFullRefreshKey(username));
    localStorage.removeItem(attendanceCacheKey(username));
    localStorage.removeItem(lmsCoursesSyncKey(username));
  }
};

/** 科目ごとの出席率（LMS の出欠）のキャッシュ */
export const attendanceCacheKey = (username: string) => `fms_attendance_${username}`;

/** LMS のコースを最後にサーバーへ同期した日と内容 */
export const lmsCoursesSyncKey = (username: string) => `fms_lms_courses_sync_${username}`;

export const lmsEventsCacheKey = (username: string) => `fms_lms_events_${username}`;
export const lmsFullRefreshKey = (username: string) => `fms_lms_full_refresh_${username}`;

/** Moodle の pluginfile URL に、開く直前でトークンを付与する */
export const withLmsToken = (url: string, token: string) =>
  `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;

export type LmsErrorCode = 'BAD_REQUEST' | 'AUTH_FAILED' | 'TOKEN_EXPIRED' | 'API_ERROR' | 'EXCEPTION' | 'NETWORK';

export class LmsError extends Error {
  code: LmsErrorCode;
  constructor(code: LmsErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type LmsFunctionResponse = {
  events: unknown[];
  token: string;
  userId: number;
  skippedCount: number;
  fetchedCount: number;
};

/** fetch-lms-assignments を呼び出す。非2xxは LmsError に変換して throw する */
export const invokeFetchLms = async (body: Record<string, unknown>): Promise<LmsFunctionResponse> => {
  const { data, error } = await supabase.functions.invoke('fetch-lms-assignments', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let payload: { code?: LmsErrorCode; error?: string } = {};
      try { payload = await error.context.json(); } catch { /* noop */ }
      throw new LmsError(payload.code ?? 'EXCEPTION', payload.error ?? error.message);
    }
    throw new LmsError('NETWORK', error.message);
  }
  return data as LmsFunctionResponse;
};
