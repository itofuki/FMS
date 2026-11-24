/* src/pages/Mypage.tsx */

import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, lazy, Suspense } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSidebar, type ChapterLink } from "../contexts/SidebarContext";
import { useScheduledReloader } from "../hooks/useScheduledReloader";
import { TimetableContainer, type Day, type Subject } from '../components/Timetable';
// 最初に開く時間割以外のタブは、開いたときに読み込む（最初の表示を軽くするため）。
// 課題と自習室は毎日使うので、最初の表示が終わったら裏で先に読み込んでおく（切り替えを待たせない）
const loadAssignments = () => import('../components/Assignments');
const loadStudyRoom = () => import('../components/StudyRoom');
const Assignments = lazy(loadAssignments);
const StudyRoom = lazy(loadStudyRoom);
const TestPrep = lazy(() => import('../components/TestPrep'));
const Setting = lazy(() => import('../components/Setting'));
const Feedback = lazy(() => import('../components/Feedback'));
const Tips = lazy(() => import('../components/Tips'));
import { PageSkeleton, TimetableSkeleton } from '../components/Skeleton';
import DeadlineReminderSync from '../components/DeadlineReminderSync';
import { mondayOf, nowInJst, subjectTime, toYmd, weekdayOf } from '../lib/schedule';
import { applyClassExceptions, fetchClassExceptions, type ClassException } from '../lib/classExceptions';
import { useLmsCourseSync } from '../hooks/useLmsCourseSync';
import { TOGGLEABLE_MENUS, useMenuVisibility } from '../hooks/useMenuVisibility';
import { syncPushSubscription } from '../lib/push';

const VALID_DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function isDay(key: unknown): key is Day {
  return VALID_DAYS.includes(key as Day);
}

// 授業開始前の通知（サーバー側）は supabase/functions/_shared/reminders.ts の PERIOD_STARTS を使うので、変更時は両方揃えること

type TimetableRpcData = {
  id: number;
  name: string;
  teacher: string;
  wday: string;
  period: number;
  classroom: string;
  category_code: string; 
  attendance_id?: number | null; // ★RPCから返ってくるID
  /** 管理者が調整した開始・終了の時刻（'HH:MM'）。本来の時限どおりなら null */
  start_time?: string | null;
  end_time?: string | null;
};

const myPageChapters: ChapterLink[] = [
  { id: 'timetable', label: '時間割' },
  { id: 'assignments', label: '課題' },
  { id: 'study-room', label: '自習室' },
  { id: 'test-prep', label: 'テスト対策' },
  { id: 'tips', label: 'Tips' },
  { id: 'feedback', label: 'ご意見' },
  { id: 'setting', label: '設定' },
];

export default function MyPage() {
  const { setChapterLinks, activeChapter, setActiveChapter } = useSidebar();
  const [searchParams, setSearchParams] = useSearchParams();

  const [refreshKey, setRefreshKey] = useState(0);

  // root が隠したサブメニュー（テスト対策など）はメニューに出さない
  // （並び順も root が決める。切り替えられない項目は元の位置のまま、設定はいちばん下）
  const { isVisible, rank, map: menuVisibility, isLoaded: menuLoaded } = useMenuVisibility();
  const chapters = useMemo(() => {
    const toggleable = new Set<string>(TOGGLEABLE_MENUS.map(m => m.id));
    const sorted = myPageChapters.filter(c => toggleable.has(c.id)).sort((a, b) => rank(a.id) - rank(b.id));
    let i = 0;
    // 切り替えられる項目が並んでいた場所に、決められた順で入れ直す
    return myPageChapters
      .map(c => (toggleable.has(c.id) ? sorted[i++] : c))
      .filter(c => isVisible(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuVisibility]);

  useEffect(() => {
    setChapterLinks(chapters);
  }, [chapters, setChapterLinks]);
  useEffect(() => () => {
    setChapterLinks([]);
    setActiveChapter('');
  }, [setChapterLinks, setActiveChapter]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && chapters.some(c => c.id === tabFromUrl)) {
      setActiveChapter(tabFromUrl);
    } else if (!tabFromUrl) {
      setSearchParams({ tab: 'timetable' }, { replace: true });
    } else if (myPageChapters.some(c => c.id === tabFromUrl) && menuLoaded) {
      // 隠されたメニューのリンク（?tab=test-prep など）で来たときは時間割へ
      setActiveChapter('timetable');
      setSearchParams({ tab: 'timetable' }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, chapters, menuLoaded]);

  // 開いている画面が隠されたら（root が切り替えた直後など）、時間割へ移る
  useEffect(() => {
    if (activeChapter && myPageChapters.some(c => c.id === activeChapter) && !chapters.some(c => c.id === activeChapter)) {
      setActiveChapter('timetable');
    }
  }, [chapters, activeChapter, setActiveChapter]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (activeChapter && activeChapter !== tabFromUrl) {
      setSearchParams({ tab: activeChapter }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter]);

  const navigate = useNavigate();
  const [isWeeklyView, setIsWeeklyView] = useState(false);
  const [weeklySubjects, setWeeklySubjects] = useState<Record<Day, Subject[]>>({ Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] });
  // 今週のイレギュラーな授業回（休講・時刻や教室の変更・補講）。管理者が登録したもの
  const [classExceptions, setClassExceptions] = useState<ClassException[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoOpenEnabled, setAutoOpenEnabled] = useState(false);
  const [openedSubjects, setOpenedSubjects] = useState<string[]>([]);
  const [isProfileSet, setIsProfileSet] = useState(false);

  const uniqueSubjects = Object.values(weeklySubjects)
    .flat()
    .filter((subject, index, self) => 
      index === self.findIndex(s => s.id.split('-')[0] === subject.id.split('-')[0])
    )
    .map(subject => ({
      id: parseInt(subject.id.split('-')[0], 10),
      name: subject.name,
      categoryCode: subject.categoryCode, 
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const reloadTimes = [
    { hour: 9, minute: 10 }, { hour: 10, minute: 50 }, { hour: 13, minute: 15 },
    { hour: 14, minute: 55 }, { hour: 16, minute: 35 }, { hour: 18, minute: 15 },
    { hour: 19, minute: 55 },
  ];
  useScheduledReloader(reloadTimes, () => activeChapter === 'test-prep');

  // タブごとのスクロール位置を覚えておき、戻ったときに元の位置から続けられるようにする（X と同じ）
  const scrollPositions = useRef<Record<string, number>>({});
  const prevChapterRef = useRef(activeChapter);
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    if (!root) return;
    const prev = prevChapterRef.current;
    if (prev === activeChapter) return;
    scrollPositions.current[prev] = root.scrollTop;
    prevChapterRef.current = activeChapter;
    const target = scrollPositions.current[activeChapter] ?? 0;
    // 中身（遅れて読み込むタブなど）の描画を待ってから戻す
    root.scrollTop = target;
    requestAnimationFrame(() => requestAnimationFrame(() => { root.scrollTop = target; }));
  }, [activeChapter]);

  // 最初の表示が終わったら、よく使うタブ（課題・自習室）を裏で読み込んでおく
  useEffect(() => {
    if (loading) return;
    const run = () => { loadAssignments(); loadStudyRoom(); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else setTimeout(run, 1500);
  }, [loading]);

  // LMS の今学期のコースを 1 日 1 回サーバーへ同期し、変わっていたら時間割を読み直す
  useLmsCourseSync(useCallback(() => setRefreshKey(prev => prev + 1), []));

  // 端末で通知がオンなら、今のアカウントの通知先としてサーバーに登録し直す（1 回だけ）。
  // 古いアカウントを消したときなどに、端末ではオンなのに通知が届かなくなるのを防ぐ
  useEffect(() => { syncPushSubscription(); }, []);

  useEffect(() => {
    const fetchUserTimetable = async () => {
      // 読み直し（設定の保存・LMS の同期の後）では仮表示に戻さず、今の画面のまま差し替える
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        navigate("/login");
        return;
      }

      // 時間割は LMS のコースから作ったもの（get_effective_timetable）
      // 今週（土日は次の週）の月〜金のイレギュラーな授業回も一緒に読む
      const monday = mondayOf(nowInJst());
      const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
      const [timetableRes, profileRes, exceptions] = await Promise.all([
        supabase.rpc('get_effective_timetable', { p_user_id: user.id }),
        supabase.from('profiles').select('class_start_action').eq('user_id', user.id).maybeSingle(),
        fetchClassExceptions(user.id, toYmd(monday), toYmd(friday)),
      ]);
      setClassExceptions(exceptions);
      if (timetableRes.error) {
        console.error("時間割の取得に失敗しました:", timetableRes.error);
        setLoading(false);
        return;
      }
      // 「自動で開く」を選んだ場合のみ。「通知する」はサーバー（notify-scheduler）がプッシュ通知を送る
      setAutoOpenEnabled(profileRes.data?.class_start_action === 'auto_open');

      const initialSubjects: Record<Day, Subject[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] };
      const groupedSubjects = (timetableRes.data as TimetableRpcData[] || []).reduce(
        (acc: Record<Day, Subject[]>, subject: TimetableRpcData) => {
          const day = subject.wday;
          if (isDay(day)) {
            acc[day].push({
              id: `${subject.id}-${day}-${subject.period}`,
              name: subject.name,
              teacher: subject.teacher,
              wday: day,
              period: subject.period,
              classroom: subject.classroom,
              categoryCode: subject.category_code, 
              attendanceId: subject.attendance_id, // ★ RPCから取得した attendance_id を格納
              startTime: subject.start_time ?? null,
              endTime: subject.end_time ?? null,
            });
          }
          return acc;
        }, initialSubjects);

      Object.values(groupedSubjects).forEach(dayArray => {
        dayArray.sort((a, b) => a.period - b.period);
      });

      setWeeklySubjects(groupedSubjects);
      // 時間割に出せる授業があるか（なければ、設定の「時間割」へ案内する）
      setIsProfileSet(((timetableRes.data as TimetableRpcData[] | null) ?? []).length > 0);
      setLoading(false);
    };
    fetchUserTimetable();
  }, [navigate, refreshKey]);

  // 「自動で開く」: 開いたままでも時間の経過で判定できるよう、30 秒ごとに見直す
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!autoOpenEnabled) return;
    const t = window.setInterval(() => setClockTick(n => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [autoOpenEnabled]);

  useEffect(() => {
    // 曜日も時刻も日本時間で数える（端末のタイムゾーンに左右されない。デバッグ用の時刻ずらしにも従う）
    const now = nowInJst();
    const todayKey = weekdayOf(now);
    // 今日のイレギュラーな授業回を当てはめる（休講は開かない・補講は開く）
    const todaySubjects = todayKey
      ? applyClassExceptions(weeklySubjects[todayKey] || [], classExceptions, toYmd(now), todayKey, Object.values(weeklySubjects).flat())
          // 休講と、臨時授業（LMS にないので開くページがない。id が「x」で始まる）は開かない
          .filter(s => s.status !== 'cancel' && !s.id.startsWith('x'))
      : [];

    if (!autoOpenEnabled || loading || todaySubjects.length === 0) {
      return;
    }

    todaySubjects.forEach(subject => {
      // 授業ごとの時刻（管理者が調整していればその時刻）
      const timeInfo = subjectTime(subject);
      if (!timeInfo) return;

      const startTime = new Date(now);
      startTime.setHours(timeInfo.start.h, timeInfo.start.m, 0, 0);
      
      const openTime = new Date(startTime.getTime() - 5 * 60 * 1000); // 5分前
      const closeTime = new Date(startTime.getTime() + 5 * 60 * 1000); // 5分後

      // 開始5分前 〜 5分後 の間に開いた場合
      if (now >= openTime && now <= closeTime && !openedSubjects.includes(subject.id)) {
        console.log(`${subject.name} のLMSページを開きます...`);
        const dbId = subject.id.split('-')[0];
        
        // ★ attendanceIdの有無によってURLを分岐
        const url = subject.attendanceId 
          ? `https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=${subject.attendanceId}` 
          : `https://lms-tokyo.iput.ac.jp/course/view.php?id=${dbId}`;
          
        window.open(url, '_blank');
        
        setOpenedSubjects(prev => [...prev, subject.id]);
      }
    });
  }, [loading, autoOpenEnabled, weeklySubjects, classExceptions, openedSubjects, clockTick]);


  const renderMainContent = () => {
    switch (activeChapter) {
      case 'timetable':
        return (
          <TimetableContainer
            exceptions={classExceptions}
            isWeeklyView={isWeeklyView}
            onChangeView={setIsWeeklyView}
            isProfileSet={isProfileSet}
            weeklySubjects={weeklySubjects}
            subjects={uniqueSubjects}
          />
        );
      case 'assignments':
        return <Assignments subject={uniqueSubjects} />;
      case 'test-prep':
        return <TestPrep subject={uniqueSubjects} />;
      case 'study-room':
        return <StudyRoom />;
      case 'tips':
        return <Tips />;
      case 'feedback':
        return <Feedback />;
      case 'setting':
        return <Setting onSettingsSaved={() => setRefreshKey(prev => prev + 1)} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      {/* 時間割（科目）の読み込みが終わってから同期する（途中の空の科目一覧で同期しない） */}
      {!loading && <DeadlineReminderSync subjects={uniqueSubjects} />}
      {/* 各ページが列の見出し（ページ名・タブ）を貼り付けるので、パンくずリストは置かない。
          読み込み中も左のナビは出したまま、中身だけ形の合った灰色の仮表示にする */}
      {loading
        ? (activeChapter === 'timetable' || !activeChapter ? <TimetableSkeleton /> : <PageSkeleton />)
        : <Suspense fallback={<PageSkeleton />}>{renderMainContent()}</Suspense>}
    </div>
  );
}