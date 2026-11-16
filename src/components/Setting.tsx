/* src/pages/Setting.tsx */

import { useState, useEffect, useRef, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { toast } from 'sonner';
import { FiSettings } from "react-icons/fi";
import RadioGroup from "./RadioGroup";
import Collapsible from "./Collapsible";
import ChapterFrame from "../components/ChapterFrame";
import Loading from "./Loading";
import { ThemeSelector } from "./ThemeToggle";
import { useQueryClient } from "@tanstack/react-query";
import { getPushState, enablePush, disablePush, sendTestPush, type PushState } from "../lib/push";
import { getLmsSession, saveLmsSession, clearLmsSession, invokeFetchLms, LmsError, purgeLegacyLmsSecrets } from "../lib/lms";

type DeptDB = { id: number; name: string; code: string };
type CourseDB = { id: number; department_id: number; name: string; code: string };
type ClassDB = { id: number; course_id: number; name: string };
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
  const [classStartAction, setClassStartAction] = useState<ClassStartAction>('notify');
  const [deadlineHours, setDeadlineHours] = useState<number | null>(24);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [isPushBusy, setIsPushBusy] = useState(false);
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

      const [resDept, resCourse, resClass, resProfile] = await Promise.all([
        supabase.from('departments').select('*').order('id'),
        supabase.from('courses').select('*').order('id'),
        supabase.from('classes').select('*').order('id'),
        supabase.from('profiles').select('class_id, english_id, auto_open, class_start_action, deadline_reminder_hours').eq('user_id', user.id).single(),
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
        setClassStartAction((profile.class_start_action as ClassStartAction) ?? 'notify');
        setDeadlineHours(profile.deadline_reminder_hours ?? null);
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

      // 学科・コース・クラスのデータが揃ってから最後に user をセットし、フォームを1回で描画する
      // （先にセットすると、選択肢が後から段階的に現れてページが乱れる）
      setUser(user);
    };
    fetchAllData();
  }, [navigate]);


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
        class_start_action: classStartAction,
        deadline_reminder_hours: deadlineHours,
        // 旧バージョンのクライアント向けに auto_open も同期しておく
        auto_open: classStartAction === 'auto_open',
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



  if (!user) {
    return (
      <ChapterFrame icon={FiSettings} title="設定">
        <Loading />
      </ChapterFrame>
    );
  }

  const departmentOptions = departmentsDB.map(d => ({ value: String(d.id), label: d.name }));
  const courseOptions = coursesDB
    .filter(c => String(c.department_id) === String(department))
    .map(c => ({ value: String(c.id), label: c.name }));
  const classOptions = classesDB
    .filter(c => String(c.course_id) === String(baseCourse))
    .map(c => ({ value: String(c.id), label: c.name }));

  return (
    <ChapterFrame icon={FiSettings} title="設定">
      {/* w-full: 親(ChapterFrame)が items-center のため、指定しないと中身の幅に縮み、
          Advanced を開いて長い文が出たときにカードの幅が変わってしまう */}
      <div className="w-full flex flex-col items-center animate-in fade-in duration-300">
        
        <div className="w-full max-w-3xl">

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 text-left">
            <div className="text-fg transition-colors duration-300">
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

            <hr className="border-t border-line my-6" />
            
            <RadioGroup 
              legend="英語のクラスを選択してください" 
              options={englishClassOptions} 
              selectedValue={englishID ? String(englishID) : null} 
              onChange={(val) => setEnglishID(Number(val))} 
            />
            
            <div>
              <p className="block text-left text-fg font-semibold mb-2 text-sm sm:text-[15px]">テーマ</p>
              <ThemeSelector />
              <p className="text-xs text-fg-subtle mt-2">選んだ時点で反映され、この端末にだけ保存されます。</p>
            </div>

            <div ref={advancedRef}>
              <Collapsible title="Advanced" defaultOpen={isAdvancedFocused} open={isAdvancedFocused}>
                
                {/* LMS ログイン情報 */}
                <div className={`space-y-3 mb-6 p-4 rounded-xl transition-all duration-700 ${isAdvancedFocused ? 'bg-accent-soft border border-accent/80' : 'bg-surface border border-line'}`}>
                  <div>
                    <label className="block text-sm font-semibold text-accent mb-1">
                      LMS ログイン情報
                      {lmsCredentialsSaved && (
                        <span className="ml-2 text-xs text-up font-normal">✓ 接続済み</span>
                      )}
                    </label>
                    <p className="text-xs text-fg-muted">
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
                      className="w-full bg-surface border border-line rounded-lg p-3 text-fg outline-none text-sm placeholder:text-fg-subtle focus:border-accent transition-colors"
                    />
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={lmsPassword}
                      onChange={(e) => setLmsPassword(e.target.value)}
                      placeholder={lmsCredentialsSaved ? "再ログインする場合のみ入力" : "LMSのパスワード"}
                      className="w-full bg-surface border border-line rounded-lg p-3 text-fg outline-none text-sm placeholder:text-fg-subtle focus:border-accent transition-colors"
                    />
                  </div>
                  {lmsStatus && (
                    <p className={`text-xs ${lmsStatus.ok ? 'text-up' : 'text-down'}`}>
                      {lmsStatus.ok ? '✓ ' : '✗ '}{lmsStatus.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveLmsCredentials}
                      disabled={isLmsLoading}
                      className="flex-1 py-2 rounded-lg bg-accent-solid hover:bg-accent-solid-hover text-on-accent text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isLmsLoading ? '接続確認中...' : (lmsCredentialsSaved ? '再ログイン' : 'ログインして接続')}
                    </button>
                    {lmsCredentialsSaved && (
                      <button
                        type="button"
                        onClick={handleClearLmsCredentials}
                        className="px-4 py-2 rounded-lg border border-down/50 text-down hover:bg-down-soft text-sm transition-colors"
                      >
                        接続解除
                      </button>
                    )}
                  </div>
                </div>

                {/* 通知設定 */}
                <div className="space-y-5 p-4 rounded-xl bg-surface border border-line">
                  <div>
                    <label className="block text-sm font-semibold text-accent mb-1">
                      通知
                      {pushState === 'enabled' && <span className="ml-2 text-xs text-up font-normal">✓ この端末はオン</span>}
                    </label>
                    {pushState && (
                      <p className={`text-xs ${pushState === 'denied' || pushState === 'needs-install' ? 'text-warn' : 'text-fg-muted'}`}>
                        {PUSH_STATE_MESSAGES[pushState]}
                      </p>
                    )}
                    {(pushState === 'enabled' || pushState === 'disabled') && (
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={handleTogglePush}
                          disabled={isPushBusy}
                          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                            pushState === 'enabled'
                              ? 'border border-line text-fg-muted hover:bg-surface-3/50'
                              : 'bg-accent-solid hover:bg-accent-solid-hover text-on-accent'
                          }`}
                        >
                          {isPushBusy ? '処理中...' : pushState === 'enabled' ? 'この端末の通知をオフにする' : 'この端末で通知を受け取る'}
                        </button>
                        {pushState === 'enabled' && (
                          <button
                            type="button"
                            onClick={handleTestPush}
                            className="px-4 py-2 rounded-lg border border-accent/50 text-accent hover:bg-accent-soft text-sm transition-colors"
                          >
                            テスト
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="deadline-reminder" className="block text-sm text-fg mb-1">未完了の課題の締切通知</label>
                    <select
                      id="deadline-reminder"
                      value={deadlineHours === null ? 'off' : String(deadlineHours)}
                      onChange={(e) => setDeadlineHours(e.target.value === 'off' ? null : Number(e.target.value))}
                      className="w-full bg-surface border border-line rounded-lg p-2.5 text-fg outline-none text-sm focus:border-accent transition-colors"
                    >
                      {DEADLINE_HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <p className="text-xs text-fg-muted mt-1">
                      課題一覧はFMSを開いたときに更新されます。LMSで直接提出した場合は、FMSを開くと通知対象から外れます。
                    </p>
                  </div>

                  <div>
                    <RadioGroup
                      legend="授業開始5分前"
                      options={CLASS_START_OPTIONS}
                      selectedValue={classStartAction}
                      onChange={(val) => setClassStartAction(val as ClassStartAction)}
                    />
                    <p className="text-xs text-fg-muted mt-2">
                      {classStartAction === 'notify' && '出席ページを開くか選べる通知を送ります（アプリを閉じていても届きます）。'}
                      {classStartAction === 'auto_open' && 'FMSを開いている場合のみ、出席ページを自動で開きます。ポップアップブロックを解除してください。'}
                      {classStartAction === 'none' && '何もしません。'}
                    </p>
                  </div>
                </div>

              </Collapsible>
            </div>

            <div className="text-center pt-4 sm:pt-6">
              <button type="submit" disabled={loading} className="w-full max-w-xs py-2.5 sm:py-3 rounded-xl bg-accent-solid hover:bg-accent-solid-hover font-semibold text-base sm:text-lg text-on-accent shadow-lg hover:scale-105 transition-transform duration-300 disabled:opacity-50">
                {loading ? "保存中..." : "保存"}
              </button>
            </div>
          </form>

          <hr className="border-t border-line my-6 sm:my-8" />
          
          <div className="text-center">
            <h3 className="text-xs sm:text-sm md:text-base font-semibold text-fg-muted mb-3 sm:mb-4">アカウント操作</h3>
            <button onClick={handleLogout} className="w-full max-w-xs py-2.5 sm:py-3 rounded-xl bg-surface-3/50 hover:bg-down/90 font-semibold text-sm sm:text-base text-fg hover:text-on-accent border border-line hover:border-down transition-all duration-300">
              ログアウト
            </button>
          </div>
          
        </div>
      </div>
    </ChapterFrame>
  );
}