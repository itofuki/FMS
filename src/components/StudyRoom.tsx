import { useState, useEffect } from 'react';
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { FiBookOpen } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useQuery } from '@tanstack/react-query';

interface RoomSchedule {
  study: string;
  talk: string;
}

const StudyRoom = () => {
  // --- 時刻管理ロジック ---
  const [currentTime, setCurrentTime] = useState(() => 
    new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const calculateCurrentPeriod = (now: Date) => {
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const time = hours * 100 + minutes;
    if (time >= 800 && time < 1050) return 1;
    if (time >= 1050 && time < 1225) return 2;
    if (time >= 1225 && time < 1450) return 3;
    if (time >= 1450 && time < 1630) return 4;
    if (time >= 1630 && time < 1810) return 5;
    if (time >= 1810) return 6;
    return null;
  };

  const currentPeriod = calculateCurrentPeriod(currentTime);

  // --- PDF取得ロジック (Google Docs Viewerで使用) ---
  const { data: pdfPath, isLoading: isLoadingPdf } = useQuery({
    queryKey: ['studyRoomPdf', new Date().toLocaleDateString('sv-SE')],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('sv-SE'); 
      const { data: meta, error: metaError } = await supabase
        .from('schedule_metadata')
        .select('filename')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (metaError || !meta) return null;
      const { data } = supabase.storage.from('images').getPublicUrl(`studyroom/${meta.filename}`);
      return data.publicUrl;
    },
    staleTime: 1000 * 60 * 55, 
  });

  // --- 今日のスケジュール取得 (新テーブル定義: 配列型に対応) ---
  const { data: todaySchedule, isLoading: isLoadingSchedule } = useQuery({
    queryKey: ['todaySchedule', new Date().toLocaleDateString('ja-JP')], 
    queryFn: async () => {
      const today = new Date();
      const todayFormatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('room_schedules')
        .select('study_rooms, talk_rooms')
        .eq('target_date', todayFormatted)
        .maybeSingle();

      if (error || !data) return {};

      const formattedSchedule: Record<number, RoomSchedule> = {};
      // 配列のインデックス(0-5)を時限(1-6)に展開
      for (let i = 0; i < 6; i++) {
        formattedSchedule[i + 1] = {
          study: data.study_rooms?.[i] || "-",
          talk: data.talk_rooms?.[i] || "-"
        };
      }
      return formattedSchedule;
    },
    staleTime: 1000 * 60 * 60, 
  });

  const currentRooms = currentPeriod && todaySchedule ? todaySchedule[currentPeriod] : null;

  // --- 表示用データ準備 ---
  const month = currentTime.getMonth() + 1;
  const mday = currentTime.getDate();
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
  const wday = weekDays[currentTime.getDay()];
  const hours = String(currentTime.getHours()).padStart(2, '0');
  const minutes = String(currentTime.getMinutes()).padStart(2, '0');

  return (
    <ChapterFrame
      title={
        <div className="flex justify-center items-center gap-3 w-full">
          <FiBookOpen className="text-cyan-400 text-2xl sm:text-3xl" />
          <span className="font-orbitron font-bold text-cyan-300 text-glow text-xl sm:text-3xl">
            自習室
          </span>
        </div>
      }
    >
      <div className="flex flex-col items-center justify-center p-2">
        
        {/* ステータスカード */}
        <div className="w-full max-w-2xl min-w-[340px] md:min-w-[600px] bg-slate-800/80 border-2 border-cyan-400/50 rounded-xl p-4 md:p-6 mb-6 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
          <div className="flex items-center justify-center mb-6 text-cyan-300">
            <h3 className="font-bold text-glow">
              <span className="flex items-baseline justify-center">
                <span className="text-2xl md:text-4xl">{month}</span>
                <span className="text-base md:text-lg mx-0.5 md:mx-1">/</span>
                <span className="text-2xl md:text-4xl">{mday}</span>
                <span className="text-base md:text-xl ml-1">({wday})</span>
                <span className="ml-2 md:ml-4 flex items-baseline">
                  <span className="text-2xl md:text-4xl">{hours}</span>
                  <span className="text-base md:text-lg mx-0.5 md:mx-1">:</span>
                  <span className="text-2xl md:text-4xl">{minutes}</span>
                </span>
                <span className="text-base md:text-xl ml-2 text-cyan-100">
                  {currentPeriod ? `(${currentPeriod}限)` : '(授業時間外)'}
                </span>
              </span>
            </h3>
          </div>
          
          <div className="grid grid-cols-2 gap-2 md:gap-4">
            {/* 自習室 */}
            <div className="bg-slate-900 rounded-lg p-3 md:p-4 text-center border border-slate-700 flex flex-col justify-center min-h-[84px] md:min-h-[108px]">
              <p className="text-slate-400 text-xs md:text-sm mb-1">自習室</p>
              <div className="flex-1 flex items-center justify-center">
                {isLoadingSchedule ? (
                  <Loading size="sm" label="" />
                ) : currentRooms ? (
                  <span className="text-lg md:text-3xl font-bold text-white tracking-wider">{currentRooms.study}</span>
                ) : (
                  <span className="text-slate-500 text-sm">-</span>
                )}
              </div>
            </div>

            {/* 談話室 */}
            <div className="bg-slate-900 rounded-lg p-3 md:p-4 text-center border border-slate-700 flex flex-col justify-center min-h-[84px] md:min-h-[108px]">
              <p className="text-slate-400 text-xs md:text-sm mb-1">談話室</p>
              <div className="flex-1 flex items-center justify-center">
                {isLoadingSchedule ? (
                  <Loading size="sm" label="" />
                ) : currentRooms ? (
                  <span className="text-lg md:text-3xl font-bold text-white tracking-wider">{currentRooms.talk}</span>
                ) : (
                  <span className="text-slate-500 text-sm">-</span>
                )}
              </div>
            </div>
          </div>

          {!currentRooms && !isLoadingSchedule && (
            <p className="text-center text-slate-400 mt-4 text-sm md:text-base">
              現在開放されている部屋はありません
            </p>
          )}
        </div>

        {/* PDF表示セクション (Google Viewer 方式) */}
        <div className="w-full max-w-2xl my-2 flex justify-center items-center min-h-[150px]">
          {isLoadingPdf ? (
            <Loading label="スケジュール表を準備中..." />
          ) : pdfPath ? (
            <div className="w-full h-[450px] md:h-[820px] border border-slate-700 rounded overflow-hidden shadow-xl bg-white">
              <iframe
                src={`https://docs.google.com/gview?url=${encodeURIComponent(pdfPath)}&embedded=true`}
                className="w-full h-full"
              >
                <div className="p-4 text-slate-800 text-center">
                  <p>プレビューを表示できません。</p>
                  <a href={pdfPath} className="text-cyan-600 underline">ダウンロードして確認</a>
                </div>
              </iframe>
            </div>
          ) : (
            <span className="text-slate-500 italic">今週のスケジュールはまだありません</span>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default StudyRoom;