/* src/pages/Setting.tsx */

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { toast } from 'sonner';
import { Segmented, SettingRow, SettingRows, Switch } from "./ui/SettingControls";
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from "../components/ChapterFrame";
import { PageSkeleton } from "./Skeleton";
import CalendarFeedSettings from "./CalendarFeedSettings";
import LmsCourseSettings from "./LmsCourseSettings";
import AvatarSettings from "./AvatarSettings";
import AdminCourseDefaults from "./AdminCourseDefaults";
import RootRoles from "./RootRoles";
import RootMenuVisibility from "./RootMenuVisibility";
import { useUserProfile } from "../hooks/useUserProfile";
import { ThemeSelector } from "./ThemeToggle";
import { useQueryClient } from "@tanstack/react-query";
import { getPushState, enablePush, disablePush, sendTestPush, sendClassTestPush, type PushState } from "../lib/push";
import { clearLmsSession, getLmsSession, purgeLegacyLmsSecrets } from "../lib/lms";
import { onSettingsSectionRequest, takeSettingsSection } from "../lib/menu";
import { useLmsIssue } from "../lib/lmsStatus";

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

// 授業の 5 分前に何をするかの短い説明
const CLASS_START_HINTS: Record<ClassStartAction, string> = {
  notify: '通知から出席ページか QR の読み取りを選べます',
  auto_open: 'FMS を開いていれば出席ページを自動で開きます',
  none: '何もしません',
};

const PUSH_STATE_MESSAGES: Record<PushState, string> = {
  unsupported: 'このブラウザはプッシュ通知に対応していません。',
  'needs-install': 'iPhone / iPad では、Safari の共有ボタンから「ホーム画面に追加」したアプリでのみ通知を受け取れます。',
  denied: '通知がブロックされています。ブラウザ（または端末）の設定でこのサイトの通知を許可してください。',
  disabled: 'この端末では通知がオフです。',
  enabled: 'この端末で通知を受け取ります。',
};

// 設定のタブ。admin・root の項目は、その権限を持つ人にだけタブとして出す（普通の人にはタブ自体を出さない）。
// 名前は課題の「管理者モード」に合わせて日本語でそろえる（admin = 管理者、root = 開発者）
type SettingGroup = 'general' | 'admin' | 'root';
const GROUP_LABELS: Record<SettingGroup, string> = { general: '一般', admin: '管理者', root: '開発者' };

// 右の列の目次に並べる項目（id は各カードの id）。group = どのタブに入るか
const SECTIONS: { id: string; label: string; group: SettingGroup }[] = [
  { id: 'settings-notify', label: '通知', group: 'general' },
  { id: 'settings-courses', label: '時間割', group: 'general' },
  { id: 'settings-calendar', label: 'カレンダー連携', group: 'general' },
  { id: 'settings-display', label: '表示', group: 'general' },
  { id: 'settings-account', label: 'アカウント', group: 'general' },
  { id: 'settings-admin-defaults', label: 'コースの既定値', group: 'admin' },
  { id: 'settings-root-menus', label: 'メニューの表示', group: 'root' },
  { id: 'settings-root-roles', label: '権限の管理', group: 'root' },
];


type SettingProps = {
  onSettingsSaved?: () => void;
};

export default function Setting({ onSettingsSaved }: SettingProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userRole, isRoot } = useUserProfile();
  const lmsIssue = useLmsIssue();
  const isAdmin = userRole === 'admin';
  const [user, setUser] = useState<User | null>(null);
  

  
  const [classStartAction, setClassStartAction] = useState<ClassStartAction>('notify');
  const [deadlineHours, setDeadlineHours] = useState<number | null>(24);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [isPushBusy, setIsPushBusy] = useState(false);
  // 通知の設定を保存している間は、選択肢を押せないようにする
  const [savingNotify, setSavingNotify] = useState(false);

  // いま開いているタブ（通常・admin・root）と、そのタブの項目
  const [group, setGroup] = useState<SettingGroup>('general');
  const groups: SettingGroup[] = ['general', ...(isAdmin ? ['admin' as const] : []), ...(isRoot ? ['root' as const] : [])];
  const sections = SECTIONS.filter(sec => sec.group === group);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  // 目次: いま画面のどの項目を見ているか
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  // 目次を押した直後は、スクロールの途中経過で表示が揺れないよう少しの間だけ追従を止める
  const followPausedUntilRef = useRef(0);
  useEffect(() => {
    if (!user) return;
    const onScroll = () => {
      if (Date.now() < followPausedUntilRef.current) return;
      const list = sectionsRef.current;
      let current = list[0]?.id ?? '';
      for (const { id } of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 160) current = id;
      }
      // いちばん下まで来たら、最後の項目（短くて上まで届かないため）
      // （スクロールする領域がいちばん下まで来ているかで判断する）
      const root = document.querySelector<HTMLElement>('[data-scroll-root]');
      if (root && root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 8) current = list[list.length - 1]?.id ?? current;
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
  }, [user, group]);


  // 自分のアイコンから来たとき: 設定が描かれたあとに、予約された項目（アカウント）までスクロールする。
  // 上の項目が後から読み込まれて高さが変わるので、最長 5 秒の間は高さが変わるたびに合わせ直す（自分でスクロールしたらやめる）。
  // ログイン中のユーザーを読み直すたびに作り直されないよう、「読み込み済みかどうか」だけで動かす
  const ready = !!user;
  useEffect(() => {
    if (!ready) return;
    let stop: (() => void) | null = null;
    const go = () => {
      const id = takeSettingsSection();
      if (!id) return;
      stop?.();
      // 項目が入っているタブに切り替えてから移る
      const target = SECTIONS.find(sec => sec.id === id);
      if (target) setGroup(target.group);
      // 中身の領域（設定が読み込み中に描き直されても入れ替わらない外側）の高さの変化を見る
      const page = document.querySelector('[data-scroll-root] main');
      if (!page) return;
      setActiveSection(id);
      const align = () => {
        followPausedUntilRef.current = Date.now() + 400;
        // 描き直しで要素が入れ替わることがあるので、毎回探し直す
        document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'end' });
      };
      // タブの切り替えでスクロール位置が戻されたあとに合わせる
      const first = window.setTimeout(align, 60);
      const ro = new ResizeObserver(align);
      ro.observe(page);
      const end = () => {
        ro.disconnect();
        clearTimeout(first);
        clearTimeout(limit);
        window.removeEventListener('wheel', end);
        window.removeEventListener('touchmove', end);
        window.removeEventListener('keydown', end);
        stop = null;
      };
      const limit = window.setTimeout(end, 5000);
      window.addEventListener('wheel', end, { passive: true });
      window.addEventListener('touchmove', end, { passive: true });
      window.addEventListener('keydown', end);
      stop = end;
    };
    go();
    const off = onSettingsSectionRequest(go);
    return () => { off(); stop?.(); };
  }, [ready]);

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

  // 授業の 5 分前の通知を試す（「出席ページ」「QR を読み取る」のボタン付き）
  const handleClassTestPush = async () => {
    if (!user) return;
    try {
      const { sent } = await sendClassTestPush(user.id);
      toast.success(`授業前の通知を送信しました（${sent}台）`);
    } catch (e) {
      toast.error(`送信に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    purgeLegacyLmsSecrets();
  }, []);


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
    <ChapterFrame
      title="設定"
      bare
      tabs={groups.length > 1 ? groups.map(g => ({
        key: g,
        label: GROUP_LABELS[g],
        active: group === g,
        onSelect: () => {
          if (g === group) return;
          setGroup(g);
          setActiveSection(SECTIONS.find(sec => sec.group === g)?.id ?? '');
          const root = document.querySelector<HTMLElement>('[data-scroll-root]');
          if (root) root.scrollTop = 0;
        },
      })) : undefined}
    >
      <div className={`${PAGE_GRID} animate-in fade-in duration-300`}>
        {/* 右の列（広い画面）: 項目の目次と、保存が必要な項目の説明 */}
        <aside className={`hidden lg:block ${SIDE_WIDGET}`}>
          <nav aria-label="設定の項目" className="px-5 py-4 border-b border-line">
            <p className={SIDE_TITLE}>この画面の項目</p>
            <ul className="mt-2 space-y-1">
              {sections.map(sec => (
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
          {/* 通常のタブ */}
          {group === 'general' && (<>
          {/* 通知（選んだ瞬間に保存） */}
          <SettingsCard id="settings-notify" title="通知">
            <SettingRows>
              {/* この端末で受け取るか（その場で反映） */}
              <SettingRow
                label="この端末で受け取る"
                hint={pushState && pushState !== 'enabled' && pushState !== 'disabled' ? PUSH_STATE_MESSAGES[pushState] : (
                  <>
                    締切や授業の前に、この端末へ通知します
                    {/* オンのときだけ、届くかを確かめるリンクを添える */}
                    {pushState === 'enabled' && (
                      <span className="block mt-1">
                        <button type="button" onClick={handleTestPush} className="text-link font-semibold hover:underline">
                          <span className="text-[13px]">テスト通知を送る</span>
                        </button>
                        <button type="button" onClick={handleClassTestPush} className="ml-3 text-link font-semibold hover:underline">
                          <span className="text-[13px]">授業前の通知を試す</span>
                        </button>
                      </span>
                    )}
                  </>
                )}
                hintTone={pushState === 'denied' || pushState === 'needs-install' ? 'warn' : 'muted'}
              >
                {(pushState === 'enabled' || pushState === 'disabled') && (
                  <Switch checked={pushState === 'enabled'} onChange={() => handleTogglePush()} label="この端末で通知を受け取る" disabled={isPushBusy} />
                )}
              </SettingRow>
              <SettingRow label="課題の締切" hint="未完了の課題を知らせる時間" htmlFor="deadline-reminder">
                <select
                  id="deadline-reminder"
                  value={deadlineHours === null ? 'off' : String(deadlineHours)}
                  onChange={(e) => saveNotify({ deadlineHours: e.target.value === 'off' ? null : Number(e.target.value) })}
                  disabled={savingNotify}
                  className="w-32 h-9 bg-surface border border-line-strong rounded-md px-2.5 text-fg outline-none text-sm focus:border-accent transition-colors"
                >
                  {DEADLINE_HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </SettingRow>
              <SettingRow label="授業の 5 分前" hint={CLASS_START_HINTS[classStartAction]} stack>
                <Segmented
                  label="授業の 5 分前"
                  options={CLASS_START_OPTIONS}
                  value={classStartAction}
                  onChange={(val) => { if (!savingNotify) saveNotify({ classStartAction: val }); }}
                  disabled={savingNotify}
                />
              </SettingRow>
            </SettingRows>
          </SettingsCard>

          {/* 時間割。読み取れなかった曜日・時限や教室を手で入れる（その場で反映） */}
          <SettingsCard id="settings-courses" title="時間割" description="LMS のコースから自動で作ります。曜日・時限や教室が違うときは、ここで直せます。">
            <LmsCourseSettings userId={user.id} onChanged={onSettingsSaved} />
          </SettingsCard>

          {/* カレンダー連携（その場で反映） */}
          <SettingsCard id="settings-calendar" title="カレンダー連携" description="時間割と課題の締切を、iPhone や Google のカレンダーに表示します。">
            <CalendarFeedSettings userId={user.id} />
          </SettingsCard>

          {/* 表示（その場で反映。この端末だけ） */}
          <SettingsCard id="settings-display" title="表示">
            <SettingRows>
              <SettingRow label="テーマ" hint="この端末だけに反映されます" stack>
                <ThemeSelector />
              </SettingRow>
            </SettingRows>
          </SettingsCard>

          {/* アカウント */}
          <SettingsCard id="settings-account" title="アカウント">
            {/* アイコン（画像を選ぶとすぐ保存） */}
            <div className="mb-4"><AvatarSettings /></div>
            <SettingRows>
              {/* LMS の名前と ID。LMS のトークンが切れていれば、ログイン画面で入れ直す案内を出す */}
              <SettingRow
                label={user.user_metadata?.full_name || `@${user.user_metadata?.lms_username ?? ''}`}
                hint={user.user_metadata?.full_name ? `@${user.user_metadata?.lms_username ?? ''} でログイン中` : 'ログイン中'}
              >
                {lmsIssue === 'expired' || !getLmsSession() ? (
                  <Link to="/login?relogin=1" className="inline-flex items-center h-8 px-3.5 rounded-full bg-warn-soft text-warn hover:underline">
                    <span className="text-sm font-bold">LMS に再ログイン</span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-up">
                    <span className="w-2 h-2 rounded-full bg-up" aria-hidden="true" />LMS に接続中
                  </span>
                )}
              </SettingRow>
              <div className="py-3">
                <button onClick={handleLogout} className="h-9 px-4 -ml-4 rounded-full text-down hover:bg-down-soft transition-colors">
                  <span className="text-[15px] font-bold">ログアウト</span>
                </button>
              </div>
            </SettingRows>
          </SettingsCard>
          </>)}

          {/* admin のタブ・root のタブ */}
          {/* コースの既定値（管理者だけ）。LMS のコースごとに曜日・時限・教室の既定値を決める */}
          {isAdmin && group === 'admin' && (
            <SettingsCard id="settings-admin-defaults" title="コースの既定値" description="コースごとの曜日・時限・教室・担当の先生の既定値です。本人が設定した値が優先されます。">
              <AdminCourseDefaults onChanged={onSettingsSaved} />
            </SettingsCard>
          )}

          {/* 開発者（root）だけ: サブメニューの表示・並び順と、権限の管理（ほかのアカウントを管理者にする・外す） */}
          {isRoot && group === 'root' && (
            <>
            <SettingsCard id="settings-root-menus" title="メニューの表示" description="サブメニューを全員に見せるかどうかと、並び順を変えます（テスト期間だけテスト対策を出す、など）。隠してもデータは消えません。">
              <RootMenuVisibility />
            </SettingsCard>
            <SettingsCard id="settings-root-roles" title="権限の管理" description="アカウントを管理者にしたり、管理者から外したりします。">
              <RootRoles />
            </SettingsCard>
            </>
          )}

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
    // 見出しの段: 大 = ページ名（列の見出し）、中 = この項目名、小 = 各行の名前（SettingRow）。
    // 項目どうしは太い帯で区切り、中見出しの下は少しあけて、どこからどこまでが 1 つの項目かを見せる
    <section id={id} className={`scroll-mt-16 px-4 sm:px-5 pt-6 pb-5 border-b-8 border-bg transition-colors duration-700 ${highlight ? 'bg-accent-soft/60' : ''}`}>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-extrabold text-fg leading-tight">{title}</h2>
        {badge}
      </div>
      {description && <p className="mt-1.5 text-[13px] text-fg-muted leading-snug">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
