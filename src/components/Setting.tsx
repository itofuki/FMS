/* src/pages/Setting.tsx */

import { useState, useEffect, useRef, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { toast } from 'sonner';
import { FiSettings } from "react-icons/fi";
import RadioGroup from "./RadioGroup";
import Switch from "./Switch";
import Collapsible from "./Collapsible";
import ChapterFrame from "../components/ChapterFrame"; 

type DeptDB = { id: number; name: string; code: string };
type CourseDB = { id: number; department_id: number; name: string; code: string };
type ClassDB = { id: number; course_id: number; name: string };
type SettingProps = {
  onSettingsSaved?: () => void;
};

// 🌟 Web Push用のキー変換ユーティリティ
const urlB64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export default function Setting({ onSettingsSaved }: SettingProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  
  const [departmentsDB, setDepartmentsDB] = useState<DeptDB[]>([]);
  const [coursesDB, setCoursesDB] = useState<CourseDB[]>([]);
  const [classesDB, setClassesDB] = useState<ClassDB[]>([]);

  const [department, setDepartment] = useState<number | null>(null);
  const [baseCourse, setBaseCourse] = useState<number | null>(null);
  const [courseClass, setCourseClass] = useState<number | null>(null);
  
  const [englishID, setEnglishID] = useState<number | null>(null);
  const [lmsCalendarUrl, setLmsCalendarUrl] = useState<string>("");
  const [autoOpen, setAutoOpen] = useState<boolean>(true);
  const [isLightMode, setIsLightMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // 🌟 プッシュ通知用の状態を追加
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [isPushLoading, setIsPushLoading] = useState<boolean>(false);

  const advancedRef = useRef<HTMLDivElement>(null);
  const isAdvancedFocused = searchParams.get("focus") === "advanced";

  const englishClassOptions = [
    { value: "3803", label: 'A' }, { value: "3804", label: 'B' }, { value: "3805", label: 'C' },
    { value: "3806", label: 'D' }, { value: "3807", label: 'E' }, { value: "3808", label: 'F' },
    { value: "3809", label: 'G' },
  ];

  useEffect(() => {
    const fetchAllData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/login");
        return;
      }
      setUser(user);

      const [resDept, resCourse, resClass, resProfile] = await Promise.all([
        supabase.from('departments').select('*').order('id'),
        supabase.from('courses').select('*').order('id'),
        supabase.from('classes').select('*').order('id'),
        supabase.from('profiles').select('class_id, english_id, auto_open, is_light_mode, lms_calendar_url').eq('user_id', user.id).single()
      ]);

      const depts = resDept.data || [];
      const crses = resCourse.data || [];
      const clses = resClass.data || [];

      setDepartmentsDB(depts);
      setCoursesDB(crses);
      setClassesDB(clses);

      const profile = resProfile.data;

      if (profile?.class_id) {
        const myClass = clses.find(c => c.id === profile.class_id);
        if (myClass) {
          setCourseClass(myClass.id);
          const myCourse = crses.find(c => c.id === myClass.course_id);
          if (myCourse) {
            setBaseCourse(myCourse.id);
            setDepartment(myCourse.department_id);
          }
        }
        setEnglishID(profile.english_id || null);
        setLmsCalendarUrl(profile.lms_calendar_url || "");
        setAutoOpen(profile.auto_open ?? true);
        setIsLightMode(profile.is_light_mode ?? false);
      } else if (depts.length > 0 && crses.length > 0 && clses.length > 0) {
        const firstDept = depts[0];
        const firstCourse = crses.find(c => c.department_id === firstDept.id);
        if (firstCourse) {
          const firstClass = clses.find(c => c.course_id === firstCourse.id);
          setDepartment(firstDept.id);
          setBaseCourse(firstCourse.id);
          if (firstClass) setCourseClass(firstClass.id);
        }
      }
    };
    fetchAllData();
  }, [navigate]);

  // 🌟 初回ロード時にこのブラウザが通知設定済みかチェック
  useEffect(() => {
    const checkPushStatus = async () => {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          setPushEnabled(!!subscription);
        } catch (error) {
          console.error("Push status check failed:", error);
        }
      }
    };
    checkPushStatus();
  }, []);

  useEffect(() => {
    if (isLightMode) {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    }
  }, [isLightMode]);

  useEffect(() => {
    if (department && coursesDB.length > 0) {
      const availableCourses = coursesDB.filter(c => c.department_id === department);
      if (availableCourses.length > 0 && !availableCourses.find(c => c.id === baseCourse)) {
        setBaseCourse(availableCourses[0].id);
      }
    }
  }, [department, coursesDB, baseCourse]);

  useEffect(() => {
    if (baseCourse && classesDB.length > 0) {
      const availableClasses = classesDB.filter(c => c.course_id === baseCourse);
      if (availableClasses.length > 0 && !availableClasses.find(c => c.id === courseClass)) {
        setCourseClass(availableClasses[0].id);
      }
    }
  }, [baseCourse, classesDB, courseClass]);

  useEffect(() => {
    if (isAdvancedFocused && advancedRef.current) {
      const timer = setTimeout(() => {
        advancedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isAdvancedFocused, department, baseCourse]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (!courseClass) {
      toast.error("クラスを最後まで選択してください");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("profiles").upsert({
        user_id: user.id,
        class_id: courseClass,
        english_id: englishID,
        lms_calendar_url: lmsCalendarUrl ? lmsCalendarUrl.trim() : null,
        auto_open: autoOpen,
        is_light_mode: isLightMode,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
      toast.success("設定を更新しました！");

      if (onSettingsSaved) {
        onSettingsSaved();
      }

      setSearchParams({ tab: 'timetable' });
    } catch (error: any) {
      toast.error(`エラーが発生しました: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 🌟 プッシュ通知のオン・オフ切り替え処理
  const handlePushToggle = async (checked: boolean) => {
    if (!user) return;
    setIsPushLoading(true);

    try {
      if (checked) {
        // 1. ブラウザの通知許可をリクエスト
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast.error("通知が許可されていません。ブラウザの設定から通知を許可してください。");
          setPushEnabled(false);
          setIsPushLoading(false);
          return;
        }

        // 2. Service Workerに登録
        const registration = await navigator.serviceWorker.ready;
        
        // 【重要】ここでステップ1で生成したVAPIDの公開鍵をセットします
        // VITE_VAPID_PUBLIC_KEY を .env に追加するか、直接以下の文字列を置き換えてください
        const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(vapidPublicKey)
        });

        // 3. Supabaseに保存
        const { error } = await supabase.from('user_subscriptions').insert({
          user_id: user.id,
          subscription: JSON.parse(JSON.stringify(subscription))
        });

        if (error) throw error;
        setPushEnabled(true);
        toast.success("プッシュ通知をオンにしました！");

      } else {
        // オフにする処理
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          // ブラウザ側の購読を解除
          await subscription.unsubscribe();
          // DBから該当ユーザーの通知設定を削除
          await supabase.from('user_subscriptions').delete().eq('user_id', user.id);
        }
        setPushEnabled(false);
        toast.success("プッシュ通知をオフにしました。");
      }
    } catch (error: any) {
      console.error(error);
      toast.error("設定に失敗しました。詳細: " + error.message);
      setPushEnabled(!checked); // 失敗したらスイッチを戻す
    } finally {
      setIsPushLoading(false);
    }
  };

  // 🌟 テスト通知を送信する処理
  const handleTestNotification = async () => {
    if (!user) return;
    toast.info("通知を送信中...");
    
    try {
      // SupabaseのEdge Functions 'send-push' を呼び出す
      const { error } = await supabase.functions.invoke('send-push', {
        body: {
          user_id: user.id,
          title: "テスト通知🚀",
          body: "FMSからのプッシュ通知テストに成功しました！"
        }
      });

      if (error) throw error;
      toast.success("サーバーから通知を送信しました！");
      
    } catch (error: any) {
      console.error(error);
      toast.error("送信エラー: " + error.message);
    }
  };

  const handleLogout = async () => {
    toast.success("ログアウトしました。");
    await supabase.auth.signOut();
    navigate("/");
  };

  if (!user) return <div>Loading...</div>;

  const departmentOptions = departmentsDB.map(d => ({ value: String(d.id), label: d.name }));
  const courseOptions = coursesDB
    .filter(c => String(c.department_id) === String(department))
    .map(c => ({ value: String(c.id), label: c.name }));
  const classOptions = classesDB
    .filter(c => String(c.course_id) === String(baseCourse))
    .map(c => ({ value: String(c.id), label: c.name }));

  return (
    <ChapterFrame
      title={
        <div className="flex justify-center items-center gap-2 sm:gap-3 w-full">
          <FiSettings className="text-cyan-400 text-xl sm:text-3xl" />
          <span className="font-orbitron font-bold text-cyan-300 text-glow text-xl sm:text-3xl">
            設定
          </span>
        </div>
      }
    >
      <div className="flex flex-col items-center justify-center p-1 sm:p-2 animate-in fade-in duration-300">
        
        <div className="w-full max-w-3xl bg-slate-800/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 sm:p-6 md:p-8 mb-6 shadow-xl">

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 text-left">
            <div className="text-slate-800 dark:text-slate-200 transition-colors duration-300">
              <RadioGroup 
                legend="所属する学科を選択してください" 
                options={departmentOptions} 
                selectedValue={department ? String(department) : null} 
                onChange={(val) => setDepartment(Number(val))} 
              />
            </div>
            
            {department && courseOptions.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <RadioGroup 
                  legend="コースを選択してください" 
                  options={courseOptions} 
                  selectedValue={baseCourse ? String(baseCourse) : null} 
                  onChange={(val) => setBaseCourse(Number(val))} 
                />
              </div>
            )}

            {baseCourse && classOptions.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <RadioGroup 
                  legend="クラスを選択してください" 
                  options={classOptions} 
                  selectedValue={courseClass ? String(courseClass) : null} 
                  onChange={(val) => setCourseClass(Number(val))} 
                />
              </div>
            )}

            <hr className="border-t border-white/10 my-6" />
            
            <RadioGroup 
              legend="英語のクラスを選択してください" 
              options={englishClassOptions} 
              selectedValue={englishID ? String(englishID) : null} 
              onChange={(val) => setEnglishID(Number(val))} 
            />
            
            <div ref={advancedRef}>
              <Collapsible title="Advanced" defaultOpen={isAdvancedFocused} open={isAdvancedFocused}>
                
                {/* LMSカレンダーURLの設定 */}
                <div className={`space-y-2 mb-6 p-4 rounded-xl transition-all duration-700 ${isAdvancedFocused ? 'bg-cyan-900/40 border border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-slate-900/20 border border-slate-700/50'}`}>
                  <label className="block text-sm font-semibold text-cyan-100">
                    LMS カレンダーURL (任意)
                  </label>
                  <input
                    type="url"
                    value={lmsCalendarUrl}
                    onChange={(e) => setLmsCalendarUrl(e.target.value)}
                    placeholder="https://lms-tokyo.iput.ac.jp/calendar/export_execute.php?..."
                    className={`w-full bg-slate-900 border rounded-lg p-3 text-slate-200 outline-none transition-colors text-sm placeholder:text-slate-600 ${isAdvancedFocused ? 'border-cyan-500 focus:border-cyan-300' : 'border-slate-600 focus:border-cyan-400'}`}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    LMSから取得したカレンダーの「エクスポートURL」を入力すると、個人の課題が自動で反映されます。
                  </p>
                </div>

                <div className="space-y-6">
                  {/* 自動オープンのスイッチ */}
                  <div>
                    <Switch label="授業開始前に自動で出席確認を開く" checked={autoOpen} onChange={setAutoOpen} />
                    <p className="text-xs text-slate-400 mt-2">※ポップアップブロックを解除してください</p>
                  </div>

                  {/* 🌟 プッシュ通知のスイッチを追加 */}
                  <div className="pt-2 border-t border-slate-700/50">
                    <Switch 
                      label={isPushLoading ? "設定中..." : "プッシュ通知を受け取る"} 
                      checked={pushEnabled} 
                      onChange={handlePushToggle} 
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      ※この端末で課題の追加などの通知を受け取ります。
                    </p>

                    {/* 🌟 テスト送信ボタンを追加 */}
                    {pushEnabled && (
                      <button 
                        onClick={handleTestNotification}
                        type="button"
                        className="w-full py-2 rounded-lg border border-cyan-500 text-cyan-400 hover:bg-cyan-500/20 text-sm font-semibold transition-colors"
                      >
                        通知をテスト送信する
                      </button>
                    )}
                  </div>
                </div>

              </Collapsible>
            </div>

            <div className="text-center pt-4 sm:pt-6">
              <button type="submit" disabled={loading} className="w-full max-w-xs py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-semibold text-base sm:text-lg text-white shadow-lg hover:scale-105 transition-transform duration-300 disabled:opacity-50">
                {loading ? "保存中..." : "保存"}
              </button>
            </div>
          </form>

          <hr className="border-t border-white/10 my-6 sm:my-8" />
          
          <div className="text-center">
            <h3 className="text-xs sm:text-sm md:text-base font-semibold text-slate-400 mb-3 sm:mb-4">アカウント操作</h3>
            <button onClick={handleLogout} className="w-full max-w-xs py-2.5 sm:py-3 rounded-xl bg-slate-700/50 hover:bg-red-500/80 font-semibold text-sm sm:text-base text-white border border-white/10 hover:border-red-500 transition-all duration-300">
              ログアウト
            </button>
          </div>
          
        </div>
      </div>
    </ChapterFrame>
  );
}