/* src/pages/Mypage.tsx */

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { useSidebar, type ChapterLink } from "../contexts/SidebarContext";
import { useScheduledReloader } from "../hooks/useScheduledReloader";
import { type IconType } from 'react-icons';
import { FiCpu, FiWifi, FiGitPullRequest, FiPlay, FiFilm, FiHelpCircle } from "react-icons/fi";
import { TimetableContainer, type Day, type Subject } from '../components/Timetable';
import StudyRoom from '../components/StudyRoom';
import Assignments from '../components/Assignments';
import TestPrep from '../components/TestPrep';
import Setting from '../components/Setting';
import Feedback from '../components/Feedback';
import Tips from '../components/Tips';
import Loading from '../components/Loading';
import DeadlineReminderSync from '../components/DeadlineReminderSync';

const VALID_DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function isDay(key: unknown): key is Day {
  return VALID_DAYS.includes(key as Day);
}

// 授業開始前の通知（サーバー側）は supabase/functions/_shared/reminders.ts の PERIOD_STARTS を使うので、変更時は両方揃えること
const periodTimes = [
  { period: 1, start: { h: 9, m: 15 }, end: { h: 10, m: 55 } },
  { period: 2, start: { h: 10, m: 55 }, end: { h: 12, m: 25 } },
  { period: 3, start: { h: 13, m: 20 }, end: { h: 14, m: 50 } },
  { period: 4, start: { h: 15, m: 0 }, end: { h: 16, m: 30 } },
  { period: 5, start: { h: 16, m: 40 }, end: { h: 18, m: 10 } },
  { period: 6, start: { h: 18, m: 20 }, end: { h: 19, m: 50 } },
];

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

type CourseStyle = {
  icon: IconType;
  label: string;
  color: string;
};

const courseStyles: Record<string, CourseStyle> = {
  'IA': { icon: FiCpu, label: 'AI', color: 'text-purple-600 dark:text-purple-400' },
  'IS': { icon: FiWifi, label: 'IoT', color: 'text-sky-600 dark:text-sky-400' },
  'IR': { icon: FiGitPullRequest, label: 'Robot', color: 'text-orange-600 dark:text-orange-400' },
  'DL': { icon: FiHelpCircle, label: 'Planner', color: 'text-pink-600 dark:text-pink-400' },
  'DG': { icon: FiPlay, label: 'Programmer', color: 'text-emerald-600 dark:text-emerald-400' },
  'DC': { icon: FiFilm, label: 'CG', color: 'text-amber-600 dark:text-amber-400' },
};

const getCourseStyle = (courseName: string): CourseStyle | null => {
  if (!courseName) return null;
  const lowerCaseCourseName = courseName.toLowerCase();
  
  const matchedKey = Object.keys(courseStyles).find(key => 
    lowerCaseCourseName.includes(key.toLowerCase())
  );

  if (matchedKey) {
    return courseStyles[matchedKey];
  }
  
  return {
    icon: FiHelpCircle,
    label: '未選択',
    color: 'text-fg-muted',
  };
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
  const [user, setUser] = useState<User | null>(null);
  const [courseName, setCourseName] = useState<string>("");
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

  useEffect(() => {
    const fetchUserTimetable = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        navigate("/login");
        return;
      }

      setUser(user);
      
      // ★ RPCを呼び出してデータを一括取得！フロントエンドのコードが超シンプルになります。
      const [timetableRes, profileRes] = await Promise.all([
        supabase.rpc('get_user_timetable', { p_user_id: user.id }),
        supabase.from("profiles").select(`
          class_start_action,
          classes (
            courses (
              name
            )
          )
        `).eq("user_id", user.id).single()
      ]);
      
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
        
        if (courseNameValue) {
          setCourseName(courseNameValue);
          setIsProfileSet(true);
        } else {
          setCourseName("コース未設定");
          setIsProfileSet(false);
        }
        
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
      const timeInfo = periodTimes.find(p => p.period === subject.period);
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

  if (loading) {
    return <Loading fullScreen />;
  }

  const courseStyle = getCourseStyle(courseName);

  const renderMainContent = () => {
    switch (activeChapter) {
      case 'timetable':
        return (
          <TimetableContainer
            isWeeklyView={isWeeklyView}
            onChangeView={setIsWeeklyView}
            courseStyle={courseStyle}
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
      <DeadlineReminderSync subjects={uniqueSubjects} />
      <div className="w-full max-w-5xl mx-auto lg:max-w-none pt-16">
        {/* パンくずリスト: 現在地を小さく示し、大きな見出しで場所を取らない */}
        <div className="flex items-center justify-between gap-3 mb-3 px-1 text-xs sm:text-sm">
          <nav aria-label="現在地" className="flex items-center gap-1.5 text-fg-muted min-w-0">
            <span>マイページ</span>
            <span aria-hidden="true" className="text-fg-subtle">›</span>
            <span className="font-semibold text-fg truncate">{myPageChapters.find(c => c.id === activeChapter)?.label ?? ''}</span>
          </nav>
          {user && <span className="hidden sm:inline text-fg-muted truncate">{user.email}</span>}
        </div>
        {renderMainContent()}
      </div>
    </div>
  );
}