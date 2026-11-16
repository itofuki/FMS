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
import Loading from "./Loading";
import { useQueryClient } from "@tanstack/react-query";
import { getLmsSession, saveLmsSession, clearLmsSession, invokeFetchLms, LmsError, purgeLegacyLmsSecrets } from "../lib/lms";

type DeptDB = { id: number; name: string; code: string };
type CourseDB = { id: number; department_id: number; name: string; code: string };
type ClassDB = { id: number; course_id: number; name: string };
type SettingProps = {
  onSettingsSaved?: () => void;
};

export default function Setting({ onSettingsSaved }: SettingProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  
  const [departmentsDB, setDepartmentsDB] = useState<DeptDB[]>([]);
  const [coursesDB, setCoursesDB] = useState<CourseDB[]>([]);
  const [classesDB, setClassesDB] = useState<ClassDB[]>([]);

  const [department, setDepartment] = useState<number | null>(null);
  const [baseCourse, setBaseCourse] = useState<number | null>(null);
  const [courseClass, setCourseClass] = useState<number | null>(null);
  
  const [englishID, setEnglishID] = useState<number | null>(null);
  const [autoOpen, setAutoOpen] = useState<boolean>(true);
  const [isLightMode, setIsLightMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const [lmsUsername, setLmsUsername] = useState('');
  const [lmsPassword, setLmsPassword] = useState('');
  const [isLmsLoading, setIsLmsLoading] = useState(false);
  const [lmsStatus, setLmsStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [lmsCredentialsSaved, setLmsCredentialsSaved] = useState(() => !!getLmsSession());

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
        supabase.from('profiles').select('class_id, english_id, auto_open, is_light_mode').eq('user_id', user.id).single(),
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
    } catch (error) {
      toast.error(`エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
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
    toast.success("ログアウトしました。");
    await supabase.auth.signOut();
    navigate("/");
  };

  if (!user) return <Loading fullScreen />;

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
                
                {/* LMS ログイン情報 */}
                <div className={`space-y-3 mb-6 p-4 rounded-xl transition-all duration-700 ${isAdvancedFocused ? 'bg-cyan-900/40 border border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-slate-900/20 border border-slate-700/50'}`}>
                  <div>
                    <label className="block text-sm font-semibold text-cyan-100 mb-1">
                      LMS ログイン情報
                      {lmsCredentialsSaved && (
                        <span className="ml-2 text-xs text-emerald-400 font-normal">✓ 接続済み</span>
                      )}
                    </label>
                    <p className="text-xs text-slate-400">
                      LMSのIDとパスワードでログインすると課題を自動取得できます。
                      パスワードは保存されず、ログイン後に発行されるLMSのアクセストークンのみをこのブラウザ内に保存します。
                      トークンの有効期限が切れた場合は、再度ログインしてください。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      autoComplete="username"
                      value={lmsUsername}
                      onChange={(e) => setLmsUsername(e.target.value)}
                      placeholder="LMSのユーザーID"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-slate-200 outline-none text-sm placeholder:text-slate-600 focus:border-cyan-400 transition-colors"
                    />
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={lmsPassword}
                      onChange={(e) => setLmsPassword(e.target.value)}
                      placeholder={lmsCredentialsSaved ? "再ログインする場合のみ入力" : "LMSのパスワード"}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-slate-200 outline-none text-sm placeholder:text-slate-600 focus:border-cyan-400 transition-colors"
                    />
                  </div>
                  {lmsStatus && (
                    <p className={`text-xs ${lmsStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {lmsStatus.ok ? '✓ ' : '✗ '}{lmsStatus.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveLmsCredentials}
                      disabled={isLmsLoading}
                      className="flex-1 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isLmsLoading ? '接続確認中...' : (lmsCredentialsSaved ? '再ログイン' : 'ログインして接続')}
                    </button>
                    {lmsCredentialsSaved && (
                      <button
                        type="button"
                        onClick={handleClearLmsCredentials}
                        className="px-4 py-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 text-sm transition-colors"
                      >
                        接続解除
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  {/* 自動オープンのスイッチ */}
                  <div>
                    <Switch label="授業開始前に自動で出席確認を開く" checked={autoOpen} onChange={setAutoOpen} />
                    <p className="text-xs text-slate-400 mt-2">※ポップアップブロックを解除してください</p>
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