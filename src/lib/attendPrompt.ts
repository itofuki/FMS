/* src/lib/attendPrompt.ts
 * 授業前の通知から FMS を開いたときの「出席のしかた」の選択（AttendPrompt）に渡す内容を、URL から読み取る。
 */
import { LMS_BASE } from './lms';

export type AttendPromptInfo = { name: string; period: string; start: string; room: string; link: string | null };

/** 通知から開いた URL（?attend=1&...）から、選択の画面に出す内容を読み取る。なければ null */
export function readAttendPrompt(params: URLSearchParams): AttendPromptInfo | null {
  if (params.get('attend') !== '1') return null;
  const raw = params.get('link');
  let link: string | null = null;
  try {
    if (raw && new URL(raw).host === new URL(LMS_BASE).host) link = raw;
  } catch {
    link = null;
  }
  return {
    name: params.get('name') ?? '',
    period: params.get('period') ?? '',
    start: params.get('start') ?? '',
    room: params.get('room') ?? '',
    link,
  };
}
