/* src/pages/Mypage.tsx */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSidebar, type ChapterLink } from "../contexts/SidebarContext";
import { useScheduledReloader } from "../hooks/useScheduledReloader";
import { TimetableContainer, type Day, type Subject } from '../components/Timetable';
import StudyRoom from '../components/StudyRoom';
import Assignments from '../components/Assignments';
import TestPrep from '../components/TestPrep';
import Setting from '../components/Setting';
import Feedback from '../components/Feedback';
import Tips from '../components/Tips';
import { PageSkeleton, TimetableSkeleton } from '../components/Skeleton';
import DeadlineReminderSync from '../components/DeadlineReminderSync';
import { menuGroupLabel } from '../lib/menu';
import { PERIODS } from '../lib/schedule';
import { useLmsCourseSync } from '../hooks/useLmsCourseSync';

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

  useEffect(() => {
    setChapterLinks(myPageChapters);
    return () => {
      setChapterLinks([]);
      setActiveChapter('');
    };
  }, [setChapterLinks, setActiveChapter]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && myPageChapters.some(c => c.id === tabFromUrl)) {
      setActiveChapter(tabFromUrl);
    } else if (!tabFromUrl) {
      setSearchParams({ tab: 'timetable' }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (activeChapter && activeChapter !== tabFromUrl) {
      setSearchParams({ tab: activeChapter }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter]);

  const navigate = useNavigate();
  // （ログイン中のユーザー自体は保持しない。メールアドレスは設定の「アカウント」に表示する）
  const [isWeeklyView, setIsWeeklyView] = useState(false);
  const [weeklySubjects, setWeeklySubjects] = useState<Record<Day, Subject[]>>({ Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] });
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

  // LMS の今学期のコースを 1 日 1 回サーバーへ同期し、変わっていたら時間割を読み直す
  useLmsCourseSync(useCallback(() => setRefreshKey(prev => prev + 1), []));

  useEffect(() => {
    const fetchUserTimetable = async () => {
      // 読み直し（設定の保存・LMS の同期の後）では仮表示に戻さず、今の画面のまま差し替える
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        navigate("/login");
        return;
      }

      // 時間割は get_effective_timetable（LMS のコースがあればそこから、なければ学科・クラスから）
      const [effectiveRes, profileRes] = await Promise.all([
        supabase.rpc('get_effective_timetable', { p_user_id: user.id }),
        supabase.from("profiles").select(`
          class_start_action,
          classes (
            courses (
              name
            )
          )
        `).eq("user_id", user.id).single()
      ]);
      
      // サーバーの更新（マイグレーション）が済む前でも表示できるよう、従来の時間割に切り替える
      const timetableRes = effectiveRes.error
        ? await supabase.rpc('get_user_timetable', { p_user_id: user.id })
        : effectiveRes;
      if (timetableRes.error) {
        console.error("RPC関数の呼び出しに失敗しました:", timetableRes.error);
        setLoading(false);
        return;
      }

      if (profileRes.error) {
        console.error("プロフィール情報の取得に失敗:", profileRes.error);
        setIsProfileSet(false);
      } else {
        type ProfileWithCourse = {
          class_start_action: string | null;
          classes: { courses: { name: string } | { name: string }[] | null } | { courses: { name: string } | { name: string }[] | null }[] | null;
        };
        const profileData = profileRes.data as unknown as ProfileWithCourse | null;
        
        let courseNameValue = null;
        if (profileData && profileData.classes) {
          const cls = Array.isArray(profileData.classes) ? profileData.classes[0] : profileData.classes;
          if (cls && cls.courses) {
            const crs = Array.isArray(cls.courses) ? cls.courses[0] : cls.courses;
            courseNameValue = crs?.name;
          }
        }
        
        // 学科・クラスが設定済みなら、従来の時間割を出せる
        setIsProfileSet(!!courseNameValue);
        
        // 「自動で開く」を選んだ場合のみ。「通知する」はサーバー（notify-scheduler）がプッシュ通知を送る
        setAutoOpenEnabled(profileData?.class_start_action === 'auto_open');
      }

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
            });
          }
          return acc;
        }, initialSubjects);

      Object.values(groupedSubjects).forEach(dayArray => {
        dayArray.sort((a, b) => a.period - b.period);
      });

      setWeeklySubjects(groupedSubjects);
      // LMS から時間割ができていれば、学科・クラスを設定していなくても表示する
      if ((timetableRes.data as TimetableRpcData[] | null)?.length) setIsProfileSet(true);
      setLoading(false);
    };
    fetchUserTimetable();
  }, [navigate, refreshKey]);

  useEffect(() => {
    const todayKey = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][new Date().getDay() - 1];
    const todaySubjects = weeklySubjects[todayKey as Day] || [];

    if (!autoOpenEnabled || loading || todaySubjects.length === 0) {
      return;
    }

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    todaySubjects.forEach(subject => {
      const timeInfo = PERIODS.find(p => p.period === subject.period);
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
  }, [loading, autoOpenEnabled, weeklySubjects, openedSubjects]);


  const renderMainContent = () => {
    switch (activeChapter) {
      case 'timetable':
        return (
          <TimetableContainer
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
    <div className="px-1 py-4 md:p-6 lg:py-8 lg:pl-8 lg:pr-0">
      {/* 広い画面では右側の内側の余白をなくし、右の列の外側の余白をメニューの左側（32px）にそろえる */}
      {/* 時間割（科目）の読み込みが終わってから同期する（途中の空の科目一覧で同期しない） */}
      {!loading && <DeadlineReminderSync subjects={uniqueSubjects} />}
      <div className="w-full max-w-5xl mx-auto lg:max-w-none pt-16">
        {/* パンくずリスト: 現在地を小さく示し、大きな見出しで場所を取らない */}
        <div className="flex items-center justify-between gap-3 mb-3 px-1 text-xs sm:text-sm">
          <nav aria-label="現在地" className="flex items-center gap-1.5 text-fg-muted min-w-0">
            {/* 先頭は、サイドメニューのどちらのグループ（メニュー／サブメニュー）にいるか */}
            <span>{menuGroupLabel(activeChapter)}</span>
            <span aria-hidden="true" className="text-fg-subtle">›</span>
            <span className="font-semibold text-fg truncate">{myPageChapters.find(c => c.id === activeChapter)?.label ?? ''}</span>
          </nav>
        </div>
        {/* 読み込み中も画面の枠（メニュー・パンくず）は出したまま、中身だけ形の合った灰色の仮表示にする */}
        {loading
          ? (activeChapter === 'timetable' || !activeChapter ? <TimetableSkeleton /> : <PageSkeleton />)
          : renderMainContent()}
      </div>
    </div>
  );
}