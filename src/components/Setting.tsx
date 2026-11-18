/* src/pages/Setting.tsx */

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { toast } from 'sonner';
import RadioGroup from "./RadioGroup";
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from "../components/ChapterFrame";
import { PageSkeleton } from "./Skeleton";
import CalendarFeedSettings from "./CalendarFeedSettings";
import LmsCourseSettings from "./LmsCourseSettings";
import AvatarSettings from "./AvatarSettings";
import { ThemeSelector } from "./ThemeToggle";
import { useQueryClient } from "@tanstack/react-query";
import { getPushState, enablePush, disablePush, sendTestPush, type PushState } from "../lib/push";
import { getLmsSession, saveLmsSession, clearLmsSession, invokeFetchLms, LmsError, purgeLegacyLmsSecrets } from "../lib/lms";

type ClassStartAction = 'auto_open' | 'notify' | 'none';

const DEADLINE_HOUR_OPTIONS: { value: string; label: string }[] = [
  { value: 'off', label: '通知しない' },
  { value: '72', label: '3日前' },
  { value: '48', label: '2日前' },
  { value: '24', label: '24時間前' },
  { value: '12', label: '12時間前' },
  { value: '6', label: '6時間前' },
  { value: '3', label: '3時間前' },
  { value: '1', label: '1時間前' },
];

const CLASS_START_OPTIONS: { value: ClassStartAction; label: string }[] = [
  { value: 'notify', label: '通知する' },
  { value: 'auto_open', label: '自動で開く' },
  { value: 'none', label: '何もしない' },
];

const PUSH_STATE_MESSAGES: Record<PushState, string> = {
  unsupported: 'このブラウザはプッシュ通知に対応していません。',
  'needs-install': 'iPhone / iPad では、Safari の共有ボタンから「ホーム画面に追加」したアプリでのみ通知を受け取れます。',
  denied: '通知がブロックされています。ブラウザ（または端末）の設定でこのサイトの通知を許可してください。',
  disabled: 'この端末では通知がオフです。',
  enabled: 'この端末で通知を受け取ります。',
};

// 右の列の目次に並べる項目（id は各カードの id）
const SECTIONS = [
  { id: 'settings-lms', label: 'LMS 連携' },
  { id: 'settings-notify', label: '通知' },
  { id: 'settings-courses', label: '時間割（LMS）' },
  { id: 'settings-calendar', label: 'カレンダー連携' },
  { id: 'settings-display', label: '表示' },
  { id: 'settings-account', label: 'アカウント' },
];


type SettingProps = {
  onSettingsSaved?: () => void;
};

export default function Setting({ onSettingsSaved }: SettingProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  

  
  const [classStartAction, setClassStartAction] = useState<ClassStartAction>('notify');
  const [deadlineHours, setDeadlineHours] = useState<number | null>(24);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [isPushBusy, setIsPushBusy] = useState(false);
  // 通知の設定を保存している間は、選択肢を押せないようにする
  const [savingNotify, setSavingNotify] = useState(false);

  const [lmsUsername, setLmsUsername] = useState('');
  const [lmsPassword, setLmsPassword] = useState('');
  const [isLmsLoading, setIsLmsLoading] = useState(false);
  const [lmsStatus, setLmsStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [lmsCredentialsSaved, setLmsCredentialsSaved] = useState(() => !!getLmsSession());

  // 目次: いま画面のどの項目を見ているか
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  // 目次を押した直後は、スクロールの途中経過で表示が揺れないよう少しの間だけ追従を止める
  const followPausedUntilRef = useRef(0);
  useEffect(() => {
    if (!user) return;
    const onScroll = () => {
      if (Date.now() < followPausedUntilRef.current) return;
      let current = SECTIONS[0].id;
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 160) current = id;
      }
      // いちばん下まで来たら、最後の項目（短くて上まで届かないため）
      const last = document.getElementById(SECTIONS[SECTIONS.length - 1].id);
      if (last && last.getBoundingClientRect().bottom <= window.innerHeight - 8) current = SECTIONS[SECTIONS.length - 1].id;
      setActiveSection(current);
    };
    onScroll();
    // スクロールするのはページ全体ではなく中身の領域なので、capture で拾う
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, [user]);

  const advancedRef = useRef<HTMLDivElement>(null);
  const isAdvancedFocused = searchParams.get("focus") === "advanced";

  useEffect(() => {
    const fetchAllData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/login");
        return;
      }

      // 学科・コース・クラスは設定画面で選ばなくなったので、通知の設定だけを読む
      const { data: profile } = await supabase
        .from('profiles')
        .select('class_start_action, deadline_reminder_hours')
        .eq('user_id', user.id)
        .maybeSingle();

      // プロフィールの行がまだない人は、画面の初期値（授業開始5分前は通知・締切は24時間前）を出す
      setClassStartAction((profile?.class_start_action as ClassStartAction | null | undefined) ?? 'notify');
      setDeadlineHours(profile ? profile.deadline_reminder_hours ?? null : 24);

      // 設定を読み込んでから user をセットし、フォームを1回で描画する
      setUser(user);
    };
    fetchAllData();
  }, [navigate]);



  useEffect(() => {
    getPushState().then(setPushState).catch(() => setPushState('unsupported'));
  }, []);

  const handleTogglePush = async () => {
    if (!user || isPushBusy) return;
    setIsPushBusy(true);
    try {
      const next = pushState === 'enabled' ? await disablePush() : await enablePush();
      setPushState(next);
      if (next === 'enabled') toast.success('この端末で通知を受け取ります。');
      else if (next === 'denied') toast.error('通知が許可されませんでした。');
      else toast.success('この端末の通知をオフにしました。');
    } catch (e) {
      console.error('[Push Error]', e);
      toast.error(`通知の設定に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    if (!user) return;
    try {
      const { sent } = await sendTestPush(user.id);
      toast.success(`テスト通知を送信しました（${sent}台）`);
    } catch (e) {
      toast.error(`テスト通知の送信に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    purgeLegacyLmsSecrets();
    setLmsUsername(getLmsSession()?.username ?? '');
  }, []);

  useEffect(() => {
    if (isAdvancedFocused && advancedRef.current) {
      const timer = setTimeout(() => {
        advancedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isAdvancedFocused]);

  // 通知の設定は、選んだ瞬間に保存する（保存ボタンはない）。失敗したら元の値に戻す
  const saveNotify = async (next: { classStartAction?: ClassStartAction; deadlineHours?: number | null }) => {
    if (!user) return;
    const prev = { classStartAction, deadlineHours };
    const action = next.classStartAction ?? classStartAction;
    const hours = next.deadlineHours !== undefined ? next.deadlineHours : deadlineHours;
    setClassStartAction(action);
    setDeadlineHours(hours);
    setSavingNotify(true);
    try {
      const { error } = await supabase.from("profiles").upsert({
        user_id: user.id,
        // 学科・クラスは設定画面では扱わない（時間割は LMS から作る）。以前の値は送らずにそのまま残す
        class_start_action: action,
        deadline_reminder_hours: hours,
        // 旧バージョンのクライアント向けに auto_open も同期しておく
        auto_open: action === 'auto_open',
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      // 成功したときは知らせない（選んだ表示がそのまま残ることが合図）。失敗したときだけ元に戻して知らせる
      // 「自動で開く」の切り替えなどをマイページに反映する
      onSettingsSaved?.();
    } catch (error) {
      setClassStartAction(prev.classStartAction);
      setDeadlineHours(prev.deadlineHours);
      // Supabase のエラーは Error ではなく { message, details, hint, code } の形なので、中身を取り出して見せる
      const e = error as { message?: string; details?: string; hint?: string; code?: string };
      const text = [e?.message, e?.details, e?.hint, e?.code && `(${e.code})`].filter(Boolean).join(' ') || String(error);
      toast.error(`保存できませんでした: ${text}`, { duration: 15000 });
    } finally {
      setSavingNotify(false);
    }
  };

  const handleSaveLmsCredentials = async () => {
    if (!lmsUsername || !lmsPassword) {
      toast.error('IDとパスワードを入力してください');
      return;
    }
    setIsLmsLoading(true);
    setLmsStatus(null);
    try {
      // パスワードはこの1回の接続にだけ使い、保存しない（保存するのはMoodleのトークンのみ）
      const data = await invokeFetchLms({ username: lmsUsername, password: lmsPassword });
      saveLmsSession({ username: lmsUsername, token: data.token, userId: data.userId });
      setLmsPassword('');
      setLmsCredentialsSaved(true);
      setLmsStatus({ ok: true, message: `接続に成功しました！${data.events?.length ?? 0}件のイベントを取得できます。` });
      queryClient.invalidateQueries({ queryKey: ['lmsEvents'] });
      toast.success('LMSに接続しました。');
    } catch (e) {
      console.error('[LMS Error]', e);
      const message = e instanceof LmsError && e.code === 'AUTH_FAILED'
        ? 'IDまたはパスワードが正しくありません。'
        : `エラー: ${e instanceof Error ? e.message : String(e)}`;
      setLmsStatus({ ok: false, message });
    } finally {
      setIsLmsLoading(false);
    }
  };

  const handleClearLmsCredentials = () => {
    clearLmsSession();
    queryClient.removeQueries({ queryKey: ['lmsEvents'] });
    setLmsUsername('');
    setLmsPassword('');
    setLmsCredentialsSaved(false);
    setLmsStatus(null);
    toast.success('LMSとの接続を解除しました。');
  };

  const handleLogout = async () => {
    // ログインは LMS の ID で行うので、ログアウトしたら LMS のトークンとキャッシュも消す（共用の端末で残さないため）
    clearLmsSession();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("ログアウトしました。");
    navigate("/");
  };



  if (!user) {
    return (
      // 仮表示も列の見出しの形を持っているので、そのまま出す
      <PageSkeleton rows={4} />
    );
  }

  const scrollTo = (id: string) => {
    setActiveSection(id);
    followPausedUntilRef.current = Date.now() + 1000;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <ChapterFrame title="設定" bare>
      <div className={`${PAGE_GRID} animate-in fade-in duration-300`}>
        {/* 右の列（広い画面）: 項目の目次と、保存が必要な項目の説明 */}
        <aside className={`hidden lg:block ${SIDE_WIDGET}`}>
          <nav aria-label="設定の項目" className="px-5 py-4 border-b border-line">
            <p className={SIDE_TITLE}>この画面の項目</p>
            <ul className="mt-2 space-y-1">
              {SECTIONS.map(sec => (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(sec.id)}
                    aria-current={activeSection === sec.id ? 'location' : undefined}
                    className={`w-full text-left px-2 py-1.5 -mx-2 rounded-md transition-colors ${
                      activeSection === sec.id ? 'bg-accent-soft text-accent font-semibold' : 'text-fg hover:bg-surface-3'
                    }`}
                  >
                    <span className="text-sm">{sec.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <p className="px-5 py-4 text-sm text-fg-muted leading-relaxed">
            変更は、選んだ時点でその場で保存されます。
          </p>
        </aside>

        {/* 真ん中の列: 白い 1 枚の面に、項目を区切り線で並べる */}
        <div className={`${CENTER_PANEL} flex flex-col`}>
          {/* LMS 連携（その場で反映）。課題ページの「再ログイン」から来たときは強調する */}
          <div ref={advancedRef}>
            <SettingsCard
              id="settings-lms"
              title="LMS 連携"
              description="LMS の ID とパスワードでログインすると、課題を自動で取得します。"
              highlight={isAdvancedFocused}
              badge={lmsCredentialsSaved ? <span className="text-xs px-2 py-0.5 rounded-full bg-up-soft text-up font-bold">接続済み</span> : undefined}
            >
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    autoComplete="username"
                    value={lmsUsername}
                    onChange={(e) => setLmsUsername(e.target.value)}
                    placeholder="LMS のユーザー ID"
                    aria-label="LMS のユーザー ID"
                    className="w-full h-10 bg-surface border border-line-strong rounded-md px-3 text-fg outline-none text-sm placeholder:text-fg-subtle focus:border-accent transition-colors"
                  />
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={lmsPassword}
                    onChange={(e) => setLmsPassword(e.target.value)}
                    placeholder={lmsCredentialsSaved ? '再ログインする場合のみ入力' : 'LMS のパスワード'}
                    aria-label="LMS のパスワード"
                    className="w-full h-10 bg-surface border border-line-strong rounded-md px-3 text-fg outline-none text-sm placeholder:text-fg-subtle focus:border-accent transition-colors"
                  />
                </div>
                {lmsStatus && (
                  <p role="status" className={`text-sm ${lmsStatus.ok ? 'text-up' : 'text-down'}`}>
                    {lmsStatus.ok ? '✓ ' : '✗ '}{lmsStatus.message}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveLmsCredentials}
                    disabled={isLmsLoading}
                    className="h-9 px-4 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors disabled:opacity-50"
                  >
                    <span className="text-sm font-bold">{isLmsLoading ? '接続を確認中...' : (lmsCredentialsSaved ? '再ログイン' : 'ログインして接続')}</span>
                  </button>
                  {lmsCredentialsSaved && (
                    <button type="button" onClick={handleClearLmsCredentials} className="h-9 px-4 rounded-md border border-down/50 text-down hover:bg-down-soft transition-colors">
                      <span className="text-sm font-bold">接続を解除</span>
                    </button>
                  )}
                </div>
                <p className="text-sm text-fg-muted leading-relaxed">
                  パスワードは保存されず、ログイン後に発行される LMS のアクセストークンだけをこのブラウザに保存します。トークンの有効期限が切れたら、もう一度ログインしてください。
                </p>
              </div>
            </SettingsCard>
          </div>

          {/* 通知（選んだ瞬間に保存） */}


            <SettingsCard id="settings-notify" title="通知" description="締切が近い課題や、授業の開始前にお知らせします。">
              <div className="space-y-6">
                {/* この端末で受け取るか（その場で反映） */}
                <div>
                  <p className="text-sm sm:text-[15px] font-semibold text-fg">
                    この端末での通知
                    {pushState === 'enabled' && <span className="ml-2 text-xs text-up font-bold">オン</span>}
                  </p>
                  {pushState && (
                    <p className={`mt-1 text-sm ${pushState === 'denied' || pushState === 'needs-install' ? 'text-warn' : 'text-fg-muted'}`}>
                      {PUSH_STATE_MESSAGES[pushState]}
                    </p>
                  )}
                  {(pushState === 'enabled' || pushState === 'disabled') && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={handleTogglePush}
                        disabled={isPushBusy}
                        className={`h-9 px-4 rounded-md transition-colors disabled:opacity-50 ${
                          pushState === 'enabled'
                            ? 'border border-line-strong text-fg hover:bg-surface-2'
                            : 'bg-accent-solid hover:bg-accent-solid-hover text-on-accent'
                        }`}
                      >
                        <span className="text-sm font-bold">{isPushBusy ? '処理中...' : pushState === 'enabled' ? 'この端末の通知をオフにする' : 'この端末で通知を受け取る'}</span>
                      </button>
                      {pushState === 'enabled' && (
                        <button type="button" onClick={handleTestPush} className="h-9 px-4 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors">
                          <span className="text-sm font-bold">テスト通知を送る</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="deadline-reminder" className="block text-sm sm:text-[15px] font-semibold text-fg mb-2">未完了の課題の締切通知</label>
                  <select
                    id="deadline-reminder"
                    value={deadlineHours === null ? 'off' : String(deadlineHours)}
                    onChange={(e) => saveNotify({ deadlineHours: e.target.value === 'off' ? null : Number(e.target.value) })}
                    disabled={savingNotify}
                    className="w-full sm:w-64 h-10 bg-surface border border-line-strong rounded-md px-3 text-fg outline-none text-sm focus:border-accent transition-colors"
                  >
                    {DEADLINE_HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p className="text-sm text-fg-muted mt-2">
                    課題一覧は FMS を開いたときに更新されます。LMS で直接提出した場合は、FMS を開くと通知の対象から外れます。
                  </p>
                </div>

                <div>
                  <RadioGroup
                    legend="授業開始5分前"
                    options={CLASS_START_OPTIONS}
                    selectedValue={classStartAction}
                    onChange={(val) => { if (!savingNotify) saveNotify({ classStartAction: val as ClassStartAction }); }}
                  />
                  <p className="text-sm text-fg-muted mt-2">
                    {classStartAction === 'notify' && '出席ページを開くか選べる通知を送ります（アプリを閉じていても届きます）。'}
                    {classStartAction === 'auto_open' && 'FMS を開いている場合のみ、出席ページを自動で開きます。ポップアップブロックを解除してください。'}
                    {classStartAction === 'none' && '何もしません。'}
                  </p>
                </div>
              </div>
            </SettingsCard>


          {/* 時間割（LMS のコース）。読み取れなかった曜日・時限や教室を手で入れる（その場で反映） */}
          <SettingsCard id="settings-courses" title="時間割（LMS のコース）" description="LMS の今学期のコースから時間割を作ります。曜日・時限が読み取れないコースや教室はここで入れてください。">
            <LmsCourseSettings userId={user.id} onChanged={onSettingsSaved} />
          </SettingsCard>

          {/* カレンダー連携（その場で反映） */}
          <SettingsCard id="settings-calendar" title="カレンダー連携" description="時間割と課題の締切を、スマホやPCのカレンダーに表示します。">
            <CalendarFeedSettings userId={user.id} />
          </SettingsCard>

          {/* 表示（その場で反映） */}
          <SettingsCard id="settings-display" title="表示" description="選んだ時点で反映され、この端末にだけ保存されます。">
            <p className="text-sm sm:text-[15px] font-semibold text-fg mb-2">テーマ</p>
            <ThemeSelector />
          </SettingsCard>

          {/* アカウント */}
          <SettingsCard id="settings-account" title="アカウント">
            {/* アイコン（画像を選ぶとすぐ保存） */}
            <div className="mb-5"><AvatarSettings /></div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* LMS の ID でログインしたアカウントは、内部用のメールアドレスではなく LMS の名前と ID を出す */}
              <p className="text-sm text-fg-muted">
                {user.user_metadata?.lms_username
                  ? <>{user.user_metadata.full_name ? `${user.user_metadata.full_name}（${user.user_metadata.lms_username}）` : user.user_metadata.lms_username} でログイン中</>
                  : <>{user.email} でログイン中</>}
              </p>
              <button onClick={handleLogout} className="h-9 px-4 rounded-md border border-down/50 text-down hover:bg-down-soft transition-colors">
                <span className="text-sm font-bold">ログアウト</span>
              </button>
            </div>
          </SettingsCard>
        </div>
      </div>
    </ChapterFrame>
  );
}

/** 設定の1項目（1枚のカード）。highlight は「ここを見てほしい」ときの強調 */
function SettingsCard({ id, title, description, badge, highlight = false, children }: {
  id: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-16 px-4 sm:px-5 py-5 border-b border-line transition-colors duration-700 ${highlight ? 'bg-accent-soft/60' : ''}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-bold text-fg">{title}</h3>
        {badge}
      </div>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
