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
import Setting from '../components/Setting';
import Feedback from '../components/Feedback';
import Tips from '../components/Tips';

const VALID_DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function isDay(key: any): key is Day {
  return VALID_DAYS.includes(key);
}

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
  'IA': { icon: FiCpu, label: 'AI', color: 'text-purple-400' },
  'IS': { icon: FiWifi, label: 'IoT', color: 'text-sky-400' },
  'IR': { icon: FiGitPullRequest, label: 'Robot', color: 'text-orange-400' },
  'DL': { icon: FiHelpCircle, label: 'Planner', color: 'text-pink-400' },
  'DG': { icon: FiPlay, label: 'Programmer', color: 'text-emerald-400' },
  'DC': { icon: FiFilm, label: 'CG', color: 'text-amber-400' },
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
    color: 'text-slate-400',
  };
};

const myPageChapters: ChapterLink[] = [
  { id: 'timetable', label: '時間割' },
  { id: 'assignments', label: '課題' },
  { id: 'study-room', label: '自習室' },
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

  const toggleTimetableView = () => {
    setIsWeeklyView(prev => !prev);
  };

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
  useScheduledReloader(reloadTimes);

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
          auto_open,
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
        const profileData = profileRes.data as any;
        
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
        
        setAutoOpenEnabled(profileData?.auto_open ?? false);
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
    return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Loading...</div>;
  }

  const generateDynamicTitle = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const mday = now.getDate();
    const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
    const wday = weekDays[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    let currentPeriodLabel: string | null = null;
    for (const periodInfo of periodTimes) {
      const startTime = new Date(now);
      startTime.setHours(periodInfo.start.h, periodInfo.start.m, 0, 0);
      
      const endTime = new Date(now);
      endTime.setHours(periodInfo.end.h, periodInfo.end.m, 0, 0);

      if (now >= startTime && now <= endTime) {
        currentPeriodLabel = `${periodInfo.period}限`;
        break;
      }
    }

    return (
      <span className="flex items-baseline">
        <span className="text-2xl md:text-4xl">{month}</span>
        <span className="text-base md:text-lg mx-0.5 md:mx-1">/</span>
        <span className="text-2xl md:text-4xl">{mday}</span>
        <span className="text-base md:text-xl ml-1">({wday})</span>
        <span className="ml-2 md:ml-4 flex items-baseline">
          <span className="text-2xl md:text-4xl">{hours}</span>
          <span className="text-base md:text-lg mx-0.5 md:mx-1">:</span>
          <span className="text-2xl md:text-4xl">{minutes}</span>
        </span>
        {currentPeriodLabel && (
          <span className="text-base md:text-xl ml-1">({currentPeriodLabel})</span>
        )}
      </span>
    );
  };

  const courseStyle = getCourseStyle(courseName);

  const renderMainContent = () => {
    switch (activeChapter) {
      case 'timetable':
        return (
          <TimetableContainer
            isWeeklyView={isWeeklyView}
            toggleTimetableView={toggleTimetableView}
            dynamicTitle={generateDynamicTitle()}
            courseName={courseName}
            courseStyle={courseStyle}
            isProfileSet={isProfileSet}
            weeklySubjects={weeklySubjects}
          />
        );
      case 'assignments':
        return <Assignments subject={uniqueSubjects as any} />;
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
    <div className="px-1 py-4 md:p-6 lg:p-8">
      <div className="w-full max-w-5xl mx-auto pt-16">
        <div className="flex justify-between items-center mb-5">
            <div className="flex flex-row items-baseline space-x-2 md:space-x-4">
                <h1 className="text-[1.3rem] md:text-3xl font-bold text-white font-display pl-2">マイページ</h1>
                {user && <span className="text-sm md:text-lg font-medium text-gray-300">{user.email}</span>}
            </div>
        </div>
        {renderMainContent()}
      </div>
    </div>
  );
}