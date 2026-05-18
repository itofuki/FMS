/* src/components/Timetable.tsx */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { IconType } from 'react-icons';
import { FiMaximize, FiMinimize, FiArrowRight } from 'react-icons/fi';
import './Timetable.css';

export type Subject = {
  id: string;
  wday: string;
  period: number;
  name: string;
  classroom: string;
  teacher: string;
  categoryCode?: string;
  attendanceId?: number | null; // ★追加: attendance_idを管理
};
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';

const layoutTransition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
} as const;

const periodTimes = [
  { period: 1, start: { h: 9, m: 15 }, end: { h: 10, m: 55 } },
  { period: 2, start: { h: 10, m: 55 }, end: { h: 12, m: 25 } },
  { period: 3, start: { h: 13, m: 20 }, end: { h: 14, m: 50 } },
  { period: 4, start: { h: 15, m: 0 }, end: { h: 16, m: 30 } },
  { period: 5, start: { h: 16, m: 40 }, end: { h: 18, m: 10 } },
  { period: 6, start: { h: 18, m: 20 }, end: { h: 19, m: 50 } },
];

const formatTime = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const isCurrentClassTime = (period: number, currentTime: Date): boolean => {
  const timeInfo = periodTimes.find(p => p.period === period);
  if (!timeInfo) return false;

  const now = currentTime;

  const classStartTime = new Date(now);
  classStartTime.setHours(timeInfo.start.h, timeInfo.start.m - 5, 0, 0);

  const classEndTime = new Date(now);
  classEndTime.setHours(timeInfo.end.h, timeInfo.end.m, 0, 0);

  return now >= classStartTime && now <= classEndTime;
};


const PeriodAxis = ({ maxPeriods }: { maxPeriods: number }) => (
  <div className="flex flex-col items-center space-y-2">
    <p className="font-bold text-transparent select-none">軸</p>
    <div className="w-full space-y-2">
      {Array.from({ length: maxPeriods }, (_, i) => i + 1).map(period => (
        <div
          key={`period-axis-${period}`}
          className="w-full h-14 flex items-center justify-center text-cyan-400 font-bold text-lg md:text-2xl"
        >
          {period}
        </div>
      ))}
    </div>
  </div>
);

const DailySchedule = ({ subjects, currentTime }: { subjects: Subject[], currentTime: Date }) => (
  <motion.div className="w-full max-w-md p-4 space-y-3">
    {subjects.length > 0 ? (
      subjects.map(subject => {
        const dbId = subject.id.split('-')[0];
        // attendance_idの有無に関わらずcourse/view.phpを使用する
        const url = `https://lms-tokyo.iput.ac.jp/course/view.php?id=${dbId}`;
        
        const timeInfo = periodTimes.find(p => p.period === subject.period);
        const isCurrent = isCurrentClassTime(subject.period, currentTime);

        return (
          <a
            key={subject.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <motion.div
              layoutId={`card-container-${subject.id}`}
              transition={layoutTransition}
              animate={{ scale: isCurrent ? 1.10 : 1 }}
              className={`w-full bg-slate-800/80 border border-white/20 rounded-lg p-2 md:p-3 text-left flex items-center space-x-4 hover:bg-slate-700/60 transition-colors duration-200 ${isCurrent ? 'is-current-class' : ''}`}
            >
              <div className="flex flex-col items-center justify-center text-center basis-1/5 flex-shrink-0 pr-3 border-r border-slate-600">
                <p className="flex items-baseline text-cyan-400 font-bold text-xl md:text-2xl">
                  <span className="text-md ">{subject.period}</span>
                  <span className="text-base font-medium text-cyan-500 ml-[1px] md:ml-[3px]">限</span>
                </p>
                {timeInfo && (
                  <p className="text-gray-400 text-[9px] md:text-xs font-mono">
                    {formatTime(timeInfo.start.h, timeInfo.start.m)}-{formatTime(timeInfo.end.h, timeInfo.end.m)}
                  </p>
                )}
              </div>

              <div className="flex-grow basis-4/5 min-w-0 space-y-[2px]">
                <p className="font-semibold text-sm md:text-lg text-white truncate">{subject.name}</p>
                <p className="text-xs md:text-sm text-gray-400">{subject.classroom} / {subject.teacher}</p>
              </div>
            </motion.div>
          </a>
        );
      })
    ) : (
      <div className="text-gray-400 text-center py-10">今日の授業はありません</div>
    )}
  </motion.div>
);

const WeeklySchedule = ({ weeklySubjects, currentTime, today }: { weeklySubjects: Record<Day, Subject[]>, currentTime: Date, today: Day | null }) => {
  const MAX_PERIODS = 6;
  const days: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  return (
    <motion.div
      className="w-full max-w-3xl grid grid-cols-5 md:grid md:[grid-template-columns:auto_repeat(5,1fr)] px-2 md:px-7 gap-2 md:gap-4"
    >
      <div className="hidden md:flex">
        <PeriodAxis maxPeriods={MAX_PERIODS} />
      </div>
      {days.map(day => (
        <div
          key={day}
          className="flex flex-col items-center space-y-2 min-w-0"
        >
          <p className={`font-bold ${day === today ? 'text-cyan-300' : 'text-gray-500'}`}>{day}</p>
          <div className="w-full space-y-2">
            {Array.from({ length: MAX_PERIODS }, (_, i) => i + 1).map(period => {
              const subject = weeklySubjects[day]?.find(s => s.period === period);

              if (subject) {
                const dbId = subject.id.split('-')[0];
                // attendance_idの有無に関わらずcourse/view.phpを使用する
                const url = `https://lms-tokyo.iput.ac.jp/course/view.php?id=${dbId}`;
                
                const isCurrent = day === today && isCurrentClassTime(subject.period, currentTime);

                return (
                  <a
                    key={subject.id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block h-13 md:h-14 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    <motion.div
                      layoutId={`card-container-${subject.id}`}
                      transition={layoutTransition}
                      animate={{ scale: isCurrent ? 1.03 : 1 }}
                      className={`w-full h-full bg-slate-800/80 rounded p-1 md:p-2 flex flex-col justify-center items-center space-y-1 text-center hover:bg-slate-700/60 transition-colors duration-200 ${isCurrent ? 'is-current-class' : ''}`}
                    >
                      <p className="font-semibold text-white line-clamp-2 md:w-full text-[10px] md:text-xs">{subject.name}</p>
                    </motion.div>
                  </a>
                );
              } else {
                return (
                  <div
                    key={`${day}-${period}`}
                    className="w-full h-13 md:h-14 bg-slate-900/50 border-2 border-dashed border-slate-700 rounded-lg"
                  />
                );
              }
            })}
          </div>
        </div>
      ))}
    </motion.div>
  );
};

interface TimetableDisplayProps {
  isWeeklyView: boolean;
  weeklyData: Record<Day, Subject[]>;
}

const TimetableDisplay: React.FC<TimetableDisplayProps> = ({ isWeeklyView, weeklyData }) => {
  const [currentTime, setCurrentTime] = useState(() => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })));

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })));
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  const getTodayDay = (date: Date): Day | null => {
    const dayIndex = date.getDay(); // 0は日曜日、6は土曜日
    if (dayIndex === 0 || dayIndex === 6) {
      return null;
    }
    const days: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    return days[dayIndex - 1];
  };

  const today = getTodayDay(currentTime);
  const todaySubjects = today ? (weeklyData[today] || []) : [];

  return (
    <div className="h-full w-full flex justify-center items-center">
      <AnimatePresence mode="wait">
        {isWeeklyView ? (
          <WeeklySchedule key="weekly" weeklySubjects={weeklyData} currentTime={currentTime} today={today} />
        ) : (
          <DailySchedule key="daily" subjects={todaySubjects} currentTime={currentTime} />
        )}
      </AnimatePresence>
    </div>
  );
};


// =================================================================
// メインコンポーネント
// =================================================================

interface TimetableContainerProps {
  isWeeklyView: boolean;
  toggleTimetableView: () => void;
  dynamicTitle: React.ReactNode;
  courseName: string;
  courseStyle: {
    icon: IconType;
    label: string;
    color: string;
  } | null;
  isProfileSet: boolean;
  weeklySubjects: Record<Day, Subject[]>;
}

export const TimetableContainer: React.FC<TimetableContainerProps> = ({
  isWeeklyView,
  toggleTimetableView,
  dynamicTitle,
  courseStyle,
  isProfileSet,
  weeklySubjects,
}) => {
  return (
    <div className="flex flex-col bg-slate-900/70 backdrop-blur-lg border border-white/10 shadow-xl rounded-lg">
      <div className="relative w-full flex justify-center items-center h-15 md:h-18 px-2 sm:px-6 border-b border-slate-700">
        {courseStyle && (
          <div className={`absolute left-4 sm:left-6 flex items-center gap-1 md:gap-2 ${courseStyle.color}`}>
            <span className="md:pt-1 text-lg md:text-2xl hidden sm:block">
              <courseStyle.icon />
            </span>
            <span className="font-bold text-lg md:text-2xl">
              {courseStyle.label}
            </span>
            <span className="font-semibold text-xl hidden sm:block pt-1">
              {courseStyle.label !== '未選択' && ' Course'}
            </span>
          </div>
        )}
        <div className="flex justify-center items-baseline space-x-4 text-center">
          <h1 className="font-orbitron font-bold text-cyan-300 text-glow text-xl sm:text-3xl">
            {dynamicTitle}
          </h1>
        </div>
        <button 
          onClick={toggleTimetableView} 
          className="absolute right-4 sm:right-6 text-gray-400 hover:text-cyan-400 transition-colors duration-300" 
          aria-label="表示切替"
        >
          {isWeeklyView ? <FiMinimize size={24} /> : <FiMaximize size={24} />}
        </button>
      </div>

      {isProfileSet ? (
        <div className="flex justify-center items-center min-h-[350px] bg-slate-950 rounded-lg px-2 pt-4 pb-7">
          <TimetableDisplay isWeeklyView={isWeeklyView} weeklyData={weeklySubjects} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[350px] bg-slate-950 rounded-lg">
          <div className="text-center py-10 px-4">
            <h2 className="text-xl font-semibold text-white mb-2">時間割を表示するには設定が必要です</h2>
            <p className="text-gray-400 mb-6">所属コースと英語クラスを選択してください。</p>
            <Link to="/setting" className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105">
              <span>設定ページへ</span>
              <FiArrowRight />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};