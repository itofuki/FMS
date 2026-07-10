/* src/components/Assignments.tsx */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { FiPlus, FiTrash2, FiCalendar, FiInbox, FiFileText, FiTool, FiLink, FiEdit2, FiX, FiInfo, FiRefreshCw, FiPaperclip, FiPlay } from 'react-icons/fi';
import { format } from 'date-fns';
import { TextInput, Select, Button, Group, Checkbox, useMantineTheme, SimpleGrid } from '@mantine/core';
import { DatePickerInput, type DayProps } from '@mantine/dates';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import 'dayjs/locale/ja';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import DOMPurify from 'dompurify';

// --- 型定義 ---
type Assignment = {
  id: number;
  name: string;
  deadline: string;
  done: boolean;
  classification: 'official' | 'private';
  user_id: string | null;
  subject_name: string | null;
  url: string | null;
};

type Subject = { 
  id: number; 
  name: string; 
};

type DbSubject = {
  id: number;
  category_code: string; 
  subject_classes: any[];
  subject_departments: any[];
  subject_courses: any[];
};

interface AssignmentsProps { subject: Subject[] }

interface LmsAttachment {
  filename: string;
  url: string;
}

interface LmsEvent {
  uid: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  categoryCode?: string;
  url?: string;
  submissionStatus?: 'submitted' | 'draft' | 'new' | null;
  attachments?: LmsAttachment[];
}


type UnifiedAssignment = {
  id: number | string;
  name: string;
  deadline: string;
  done: boolean;
  classification: 'official' | 'private';
  user_id: string | null;
  subject_name: string | null;
  url: string | null;
  isLms: boolean;
  description?: string;
  subjectCategoryType: 'class' | 'department' | 'course' | 'none';
  submissionStatus?: 'submitted' | 'draft' | 'new' | null;
  attachments?: LmsAttachment[];
};

type LmsStatus = {
  lms_uid: string;
  done: boolean;
};

// --- ヘルパー関数 ---
const formatDateTime = (isoString: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  return format(date, "MM/dd HH:mm");
};
const today = new Date();
today.setHours(0, 0, 0, 0);

const getDeadlineStatus = (deadlineDate: string, isDone: boolean) => {
  if (isDone) return { color: 'text-slate-600', label: '' };
  
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const diffTime = deadline.getTime() - now.getTime();
  
  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffTime < 0) return { color: 'text-red-600 font-bold', label: '(期限切れ)' };
  
  if (diffHours < 24) {
    const hours = diffHours === 0 ? '1' : diffHours;
    return { color: 'text-red-400 font-bold', label: `(あと ${hours} 時間)` };
  }
  
  return {
    color: diffDays <= 3 ? 'text-orange-400 font-bold' : 'text-slate-400',
    label: `(あと ${diffDays} 日)`
  };
};

const getSubjectCategoryType = (dbSub?: DbSubject): 'class' | 'department' | 'course' | 'none' => {
  if (!dbSub) return 'none';
  if (dbSub.subject_classes && dbSub.subject_classes.length > 0) return 'class';
  if (dbSub.subject_departments && dbSub.subject_departments.length > 0) return 'department';
  if (dbSub.subject_courses && dbSub.subject_courses.length > 0) return 'course';
  return 'none';
};

const getBadgeStyle = (type: string, isDone: boolean) => {
  if (isDone) return 'bg-slate-700/50 text-slate-500 border-slate-600/50'; 

  switch (type) {
    case 'class': return 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50';
    case 'department': return 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50';
    case 'course': return 'bg-purple-900/30 text-purple-300 border-purple-800/50';
    default: return 'bg-cyan-900/30 text-cyan-300 border-cyan-800/50';
  }
};

const Assignments: React.FC<AssignmentsProps> = ({ subject }) => {
  const theme = useMantineTheme();
  const queryClient = useQueryClient();

  // LMS認証情報 (localStorage から読み取り)
  const [lmsCredentials] = useState(() => ({
    username: localStorage.getItem('fms_lms_username'),
    password: localStorage.getItem('fms_lms_password'),
  }));
  const hasLmsCredentials = !!(lmsCredentials.username && lmsCredentials.password);

  // --- ローカルステート ---
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newTime, setNewTime] = useState('');
  const [newSubjectId, setNewSubjectId] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');

  // 添付の音声ファイル再生用（tokenクエリ付きURLはRangeリクエストに対応していないため、Blobで一括取得して再生する）
  const [audioBlobUrls, setAudioBlobUrls] = useState<Record<string, string>>({});
  const [loadingAudioKeys, setLoadingAudioKeys] = useState<Set<string>>(new Set());
  const [audioErrorKeys, setAudioErrorKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      Object.values(audioBlobUrls).forEach(url => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- React Queryによるデータ取得 ---
  const { data: currentUser, isLoading: isLoadingUser } = useQuery<User | null>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: Infinity,
  });

  const { data: userProfile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['userProfile', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', currentUser.id)
        .single();

      if (error) {
        console.error("Profile fetch error:", error);
        return null;
      }
      return data;
    },
    enabled: !!currentUser?.id,
  });

  const userRole = userProfile?.role || 'user';

  const { data: assignments = [], isLoading: isLoadingAssignments } = useQuery<Assignment[]>({
    queryKey: ['assignments'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_assignments');
      if (error) {
        console.error('Error fetching assignments:', error);
        return [];
      }
      return data as Assignment[];
    }
  });

  // credentials があれば自動ログイン取得、なければ既存のiCal URL取得
  const LMS_EVENTS_CACHE_KEY = `fms_lms_events_${lmsCredentials.username}`;
  const LMS_FULL_REFRESH_KEY = `fms_lms_full_refresh_${lmsCredentials.username}`;
  const FULL_REFRESH_INTERVAL = 10 * 60 * 1000; // 10分に1回はフルリフレッシュ（提出削除を検知）

  const getCachedLmsEvents = (): LmsEvent[] | undefined => {
    try {
      const raw = localStorage.getItem(LMS_EVENTS_CACHE_KEY);
      if (!raw) return undefined;
      const { events, ts } = JSON.parse(raw);
      if (Date.now() - ts > 24 * 60 * 60 * 1000) return undefined;
      return events.map((e: any) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
    } catch { return undefined; }
  };

  // キャッシュから uid→submissionStatus のマップを作る
  const getCachedStatuses = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(LMS_EVENTS_CACHE_KEY);
      if (!raw) return {};
      const { events } = JSON.parse(raw);
      const map: Record<string, string> = {};
      for (const e of events ?? []) {
        if (e.uid && e.submissionStatus) map[e.uid] = e.submissionStatus;
      }
      return map;
    } catch { return {}; }
  };

  const { data: lmsEvents = [], isLoading: isLoadingLmsEvents, isFetching: isFetchingLmsEvents, isError: isLmsApiError, refetch: refetchLmsEvents } = useQuery<LmsEvent[]>({
    queryKey: ['lmsEvents', 'api', lmsCredentials.username],
    queryFn: async () => {
      const cachedToken = localStorage.getItem('fms_lms_token') ?? undefined;
      const cachedUserId = Number(localStorage.getItem('fms_lms_userid')) || undefined;

      // FULL_REFRESH_INTERVAL以上経過していたらフルリフレッシュ（差分スキップなし）
      const lastFull = Number(localStorage.getItem(LMS_FULL_REFRESH_KEY) ?? 0);
      const isFullRefresh = Date.now() - lastFull > FULL_REFRESH_INTERVAL;
      const cachedStatuses = isFullRefresh ? {} : getCachedStatuses();

      const { data, error } = await supabase.functions.invoke('fetch-lms-assignments', {
        body: {
          username: lmsCredentials.username,
          password: lmsCredentials.password,
          cachedToken,
          cachedUserId,
          cachedStatuses,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.code === 'AUTH_FAILED') throw new Error('AUTH_FAILED');
      if (data?.token) localStorage.setItem('fms_lms_token', data.token);
      if (data?.userId) localStorage.setItem('fms_lms_userid', String(data.userId));
      if (isFullRefresh) localStorage.setItem(LMS_FULL_REFRESH_KEY, String(Date.now()));
      const events: LmsEvent[] = data?.events ?? [];
      localStorage.setItem(LMS_EVENTS_CACHE_KEY, JSON.stringify({ events, ts: Date.now() }));
      return events;
    },
    placeholderData: getCachedLmsEvents,  // リロード時はキャッシュを即座に表示
    enabled: hasLmsCredentials,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const { data: dbSubjects = [], isLoading: isLoadingDbSubjects } = useQuery<DbSubject[]>({
    queryKey: ['dbSubjects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select(`
          id, 
          category_code,
          subject_classes (subject_id),
          subject_departments (subject_id),
          subject_courses (subject_id)
        `);
      if (error) {
        console.error("subjectsテーブルのJOIN取得エラー:", error);
        return [];
      }
      return data as DbSubject[];
    }
  });

  const { data: lmsStatuses = [], isLoading: isLoadingLmsStatuses } = useQuery<LmsStatus[]>({
    queryKey: ['lmsStatuses', currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      const { data, error } = await supabase.from('lms_assignment_status').select('lms_uid, done').eq('user_id', currentUser.id);
      if (error) return [];
      return data as LmsStatus[];
    },
    enabled: !!currentUser?.id,
  });

  const loading = isLoadingUser || isLoadingProfile || isLoadingAssignments || isLoadingLmsEvents || isLoadingDbSubjects || isLoadingLmsStatuses;

  // --- React Queryによるデータ更新 (Mutations) ---
  const upsertMutation = useMutation({
    mutationFn: async (payload: { isEdit: boolean, data: any, id?: number }) => {
      if (payload.isEdit) {
        const { error } = await supabase.from('assignment').update(payload.data).eq('id', payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('assignment').insert(payload.data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (error) => {
      console.error('Error saving assignment:', error);
      toast.error('課題の保存に失敗しました。権限がありません。');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('assignment').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['assignments'], (old: Assignment[] | undefined) => {
        if (!old) return old;
        return old.filter(a => a.id !== id);
      });
      if (editingId === id) resetForm();
    },
    onError: (error) => {
      console.error('Error deleting assignment:', error);
      toast.error('課題の削除に失敗しました。');
    }
  });

  const toggleDbMutation = useMutation({
    mutationFn: async ({ assignmentId, newStatus, userId }: { assignmentId: number, newStatus: boolean, userId: string }) => {
      const { error } = await supabase.from('assignment_status').upsert(
        { user_id: userId, assignment_id: assignmentId, done: newStatus }, 
        { onConflict: 'user_id, assignment_id' }
      );
      if (error) throw error;
    },
    onMutate: async ({ assignmentId, newStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['assignments'] });
      const previous = queryClient.getQueryData(['assignments']);
      queryClient.setQueryData(['assignments'], (old: Assignment[] | undefined) => {
        if (!old) return old;
        return old.map(assign => assign.id === assignmentId ? { ...assign, done: newStatus } : assign);
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      console.error('Error updating status:', error);
      if (context?.previous) queryClient.setQueryData(['assignments'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
    }
  });

  const toggleLmsMutation = useMutation({
    mutationFn: async ({ assignmentId, newStatus, userId }: { assignmentId: string, newStatus: boolean, userId: string }) => {
      const { error } = await supabase.from('lms_assignment_status').upsert(
        { user_id: userId, lms_uid: assignmentId, done: newStatus }, 
        { onConflict: 'user_id, lms_uid' }
      );
      if (error) throw error;
    },
    onMutate: async ({ assignmentId, newStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['lmsStatuses', currentUser?.id] });
      const previous = queryClient.getQueryData(['lmsStatuses', currentUser?.id]);
      queryClient.setQueryData(['lmsStatuses', currentUser?.id], (old: LmsStatus[] | undefined) => {
        if (!old) return [{ lms_uid: assignmentId, done: newStatus }];
        const existing = old.find(s => s.lms_uid === assignmentId);
        if (existing) return old.map(s => s.lms_uid === assignmentId ? { ...s, done: newStatus } : s);
        return [...old, { lms_uid: assignmentId, done: newStatus }];
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      console.error('Error updating LMS status:', error);
      toast.error('ステータスの更新に失敗しました。');
      if (context?.previous) queryClient.setQueryData(['lmsStatuses', currentUser?.id], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsStatuses', currentUser?.id] });
    }
  });

  // --- イベントハンドラー ---
  const getDayProps = (dateString: string): Partial<DayProps> => {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const styles: React.CSSProperties = {};
    if (date.getDay() === 6) { styles.color = theme.colors.blue[6]; }
    if (date.getTime() === today.getTime()) {
      styles.outline = `2px solid ${theme.colors.teal[6]}`;
      styles.outlineOffset = '-2px';
    }
    return { style: styles };
  };

  const handleDateChange = (value: Date | string | null | any) => {
    if (!value) {
      setNewDate(null);
      return;
    }
    setNewDate(new Date(value));
  };

  const resetForm = () => {
    setEditingId(null);
    setNewName('');
    setNewDate(null);
    setNewTime('');
    setNewSubjectId(null);
    setNewUrl('');
  };

  const handleEditClick = (assign: UnifiedAssignment) => {
    if (assign.isLms) return; 
    setEditingId(assign.id as number);
    setNewName(assign.name);
    setNewUrl(assign.url || '');
    const matchedSubject = subject.find(s => s.name === assign.subject_name);
    setNewSubjectId(matchedSubject ? matchedSubject.id.toString() : null);
    const dateObj = new Date(assign.deadline);
    setNewDate(dateObj);
    setNewTime(format(dateObj, 'HH:mm'));
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const handleAddOrUpdateAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !newName || !newDate) return;
    const datePart = format(newDate, 'yyyy-MM-dd');
    const timePart = newTime || '23:59';
    const deadlineForSupabase = new Date(`${datePart}T${timePart}:00`).toISOString();
    const isOfficial = isAdminMode && userRole === 'admin';
    
    if (editingId) {
      const updatePayload = {
        name: newName,
        deadline: deadlineForSupabase,
        subject_id: newSubjectId ? parseInt(newSubjectId, 10) : null,
        url: newUrl || null,
      };
      upsertMutation.mutate({ isEdit: true, id: editingId, data: updatePayload });
    } else {
      const newAssignment = {
        name: newName,
        deadline: deadlineForSupabase,
        subject_id: newSubjectId ? parseInt(newSubjectId, 10) : null,
        classification: isOfficial ? 'official' : 'private' as const,
        user_id: currentUser.id,
        url: newUrl || null,
      };
      upsertMutation.mutate({ isEdit: false, data: newAssignment });
    }
  };
  
  const handleToggleDone = (assignmentId: number | string, currentStatus: boolean, isLms: boolean) => {
    if (!currentUser) return;
    const newStatus = !currentStatus;
    if (isLms) {
      toggleLmsMutation.mutate({ assignmentId: assignmentId as string, newStatus, userId: currentUser.id });
    } else {
      toggleDbMutation.mutate({ assignmentId: assignmentId as number, newStatus, userId: currentUser.id });
    }
  };

  const handleForceRefreshLms = () => {
    if (!hasLmsCredentials || isFetchingLmsEvents) return;
    localStorage.setItem(LMS_FULL_REFRESH_KEY, '0');
    refetchLmsEvents();
  };

  const isAudioFile = (filename: string) => /\.(mp3|wav|m4a|aac|ogg|oga|flac|wma)$/i.test(filename);

  const handlePlayAudio = async (key: string, url: string) => {
    if (audioBlobUrls[key] || loadingAudioKeys.has(key)) return;
    setAudioErrorKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setLoadingAudioKeys(prev => new Set(prev).add(key));
    try {
      // token付きURLへの直接再生はMoodle側がRangeリクエストに対応しておらず途中で止まるため、
      // 一旦Blobとして丸ごと取得してからaudio要素に渡す
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setAudioBlobUrls(prev => ({ ...prev, [key]: blobUrl }));
    } catch (err) {
      console.error('音声の読み込みに失敗しました:', err);
      setAudioErrorKeys(prev => new Set(prev).add(key));
    } finally {
      setLoadingAudioKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleDeleteAssignment = (id: number | string, isLms: boolean) => {
    if (isLms) return; 
    if (!window.confirm("本当にこの課題を削除しますか？")) return;
    deleteMutation.mutate(id as number);
  };

  const getAssignmentStyles = (assignment: UnifiedAssignment): string => {
    if (assignment.classification === 'official') {
      return `bg-slate-800 border-l-4 ${assignment.done ? 'border-amber-700' : 'border-amber-400'}`;
    }
    if (assignment.done) { return 'bg-slate-800/60 border-l-4 border-slate-600'; }
    return 'bg-slate-700/80 border-l-4 border-cyan-500';
  };

  const unifiedAssignments = useMemo(() => {
    const nowDate = new Date();
    const twoWeeksLater = new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const enrolledSubjectNames = subject.map(s => s.name);
    const enrolledSubjectIds = subject.map(s => s.id);

    // 1. DB課題
    // 🚧 動作確認のため一時的に絞り込みを無効化（元は履修科目のみ表示）
    // .filter(a => !a.subject_name || enrolledSubjectNames.includes(a.subject_name))
    const dbUnified: UnifiedAssignment[] = assignments
      .map(a => {
        const matchedSubjectProp = subject.find(s => s.name === a.subject_name);
        const dbSub = matchedSubjectProp ? dbSubjects.find(s => s.id === matchedSubjectProp.id) : undefined;
        return { ...a, isLms: false, subjectCategoryType: getSubjectCategoryType(dbSub) };
      });

    // 2. LMS課題 (credentials 自動取得 or iCal URL、同じ形式で処理)
    const excludedKeywords = ['出欠', '出席', 'attendance', 'アンケート開始'];

    // 🚧 動作確認のため一時的に絞り込みを無効化（元は「2週間以内・除外キーワード対象外・履修科目一致」のみ表示）
    const filteredLms = lmsEvents;
    void twoWeeksLater;
    void excludedKeywords;
    void enrolledSubjectIds;
    void enrolledSubjectNames;

    const lmsUnified: UnifiedAssignment[] = filteredLms.map(event => {
      const matched = dbSubjects.find(
        s => s.category_code && event.categoryCode && s.category_code === event.categoryCode
      );
      let eventUrl = '';
      if (event.url) eventUrl = event.url;
      else if (matched) eventUrl = `https://lms-tokyo.iput.ac.jp/course/view.php?id=${matched.id}`;
      else if (event.categoryCode) eventUrl = `https://lms-tokyo.iput.ac.jp/course/search.php?search=${event.categoryCode}`;
      const displaySubjectName = subject.find(s => s.id === matched?.id)?.name || '未分類(LMS)';
      const manualDone = lmsStatuses.find(s => s.lms_uid === event.uid)?.done ?? false;
      // Moodleが提出済みと言っているか、自分で手動チェックしたかのどちらかで完了扱いにする。
      // 提出削除でMoodle側がfalseに戻れば、手動チェックしていない限り自動でチェックも外れる。
      const isDone = manualDone || event.submissionStatus === 'submitted';
      return {
        id: event.uid,
        name: event.summary,
        deadline: event.end || event.start,
        done: isDone,
        classification: 'official' as const,
        user_id: null,
        subject_name: displaySubjectName,
        url: eventUrl,
        isLms: true,
        description: event.description,
        subjectCategoryType: getSubjectCategoryType(matched),
        submissionStatus: event.submissionStatus,
        attachments: event.attachments,
      };
    });

    let combined = [...dbUnified, ...lmsUnified];
    if (isAdminMode && userRole === 'admin') combined = combined.filter(a => a.classification === 'official');
    // 期限切れから1日以内までは表示し、それ以降は非表示にする
    const oneDayAfterDeadlineCutoff = nowDate.getTime() - 24 * 60 * 60 * 1000;
    combined = combined.filter(a => new Date(a.deadline).getTime() >= oneDayAfterDeadlineCutoff);
    return combined.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
  }, [assignments, lmsEvents, dbSubjects, subject, isAdminMode, userRole, lmsStatuses]);

  // ... (上部のロジックはそのまま) ...

  if (loading) return <Loading />;

  return (
    <div className={`transition-all duration-300 ${isAdminMode ? 'bg-yellow-900/30' : ''}`}>
      <ChapterFrame
        title={
          <>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
              <FiFileText className={`text-2xl sm:text-3xl transition-colors ${isAdminMode ? 'text-yellow-400' : 'text-cyan-400'}`} />
              <span className={`font-orbitron font-bold text-glow text-xl sm:text-3xl transition-colors ${isAdminMode ? 'text-yellow-400' : 'text-cyan-300'}`}>
                課題
              </span>
              {hasLmsCredentials && (
                <button
                  type="button"
                  onClick={handleForceRefreshLms}
                  disabled={isFetchingLmsEvents}
                  title={isFetchingLmsEvents ? "LMS同期中..." : "LMSの提出状況を今すぐ更新"}
                  className="text-cyan-500 opacity-70 hover:opacity-100 disabled:cursor-not-allowed transition-opacity"
                >
                  <FiRefreshCw size={14} className={isFetchingLmsEvents ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
            {userRole === 'admin' && (
              <div className="absolute top-1/2 right-1 -translate-y-1/2">
                <Button
                  onClick={() => { setIsAdminMode(prev => !prev); resetForm(); }}
                  variant="outline"
                  color={isAdminMode ? "cyan" : "yellow"}
                  size="xs"
                  className="sm:px-4 sm:text-sm"
                >
                  <div className="flex items-center justify-center">
                    <FiTool size={16} />
                    <span className="hidden sm:inline ml-2">{isAdminMode ? '通常モード' : '管理者モード'}</span>
                  </div>
                </Button>
              </div>
            )}
          </>
        }
      >
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-8 p-1 sm:p-4 rounded-xl transition-all duration-300">
          <div>

            {unifiedAssignments.length === 0 ? (
              <div className="text-center py-10 px-4 bg-slate-800/30 rounded-lg border border-slate-700/30">
                <FiInbox size={32} className="mx-auto text-slate-500 mb-3" />
                <p className="text-slate-400 text-sm">{isAdminMode ? '表示できる公式課題はありません' : '直近2週間の課題はありません 🎉'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {unifiedAssignments.map(assignment => {
                  const canDelete = !assignment.isLms && ((isAdminMode && userRole === 'admin') || (assignment.classification === 'private' && assignment.user_id === currentUser?.id));
                  const cleanTitle = (title: string) => title.replace(/[「」]|の提出期限/g, '');
                  const status = getDeadlineStatus(assignment.deadline, assignment.done);

                  return (
                    <div key={assignment.id} className={`p-4 rounded-lg flex transition-all duration-300 ${getAssignmentStyles(assignment)} ring-cyan-500 ${editingId === assignment.id ? 'ring-2' : ''} h-full`}>
                      
                      {/* 共通の左端: チェックボックス */}
                      <div className="flex items-center justify-center pr-3 sm:pr-4">
                        <Checkbox
                          checked={assignment.done}
                          onChange={() => handleToggleDone(assignment.id, assignment.done, assignment.isLms)}
                          size="md"
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* --- 左右に分割するラッパー --- */}
                      <div className="flex flex-1 min-w-0 gap-3">
                        
                        {/* 🌟 左側カラム: 科目、操作ボタン、タイトル、詳細 (右側領域に干渉せず残りの幅をすべて使う) */}
                        <div className="flex flex-col flex-1 min-w-0 justify-center py-0.5">
                          
                          {/* 左側1段目: 科目バッジ と 操作ボタン */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded border inline-block truncate max-w-[150px] sm:max-w-[180px] transition-colors duration-300 ${getBadgeStyle(assignment.subjectCategoryType, assignment.done)}`}>
                              {assignment.subject_name || '未分類'}
                            </span>
                            
                            {canDelete && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => handleEditClick(assignment)} className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-700/80 rounded transition-colors"><FiEdit2 size={13}/></button>
                                <button onClick={() => handleDeleteAssignment(assignment.id, assignment.isLms)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-700/80 rounded transition-colors"><FiTrash2 size={13}/></button>
                              </div>
                            )}
                          </div>

                          {/* 左側2段目: 課題タイトル */}
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            {assignment.url ? (
                              <a
                                href={assignment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={cleanTitle(assignment.name)}
                                className={`font-bold text-base sm:text-[17px] hover:underline transition-colors flex items-center gap-2 min-w-0 ${
                                  assignment.done ? 'text-slate-500 line-through' : 'text-slate-100'
                                }`}
                              >
                                <span className="truncate min-w-0">{cleanTitle(assignment.name)}</span>
                                {assignment.submissionStatus === 'draft' && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded border border-blue-500/30 flex-shrink-0">下書き</span>}
                              </a>
                            ) : (
                              <p
                                title={cleanTitle(assignment.name)}
                                className={`font-bold text-base sm:text-[17px] transition-colors flex items-center gap-2 min-w-0 ${
                                  assignment.done ? 'text-slate-500 line-through' : 'text-slate-100'
                                }`}
                              >
                                <span className="truncate min-w-0">{cleanTitle(assignment.name)}</span>
                                {assignment.submissionStatus === 'draft' && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1 py-0.5 rounded border border-blue-500/30 flex-shrink-0">下書き</span>}
                              </p>
                            )}
                          </div>

                          {/* 左側3段目: 詳細説明 (LMSのみ) */}
                          {assignment.isLms && assignment.description && (
                            <div 
                              className={`mt-1.5 text-xs line-clamp-2 prose prose-invert prose-sm whitespace-pre-wrap transition-colors duration-300 ${
                                assignment.done ? 'text-slate-500 opacity-50' : 'text-slate-400'
                              }`}
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(assignment.description) }}
                            />
                          )}

                          {/* 左側4段目: 添付資料 (LMSのみ) */}
                          {assignment.isLms && assignment.attachments && assignment.attachments.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {assignment.attachments.map((file, i) => {
                                const key = `${assignment.id}_${i}`;
                                if (isAudioFile(file.filename)) {
                                  if (audioBlobUrls[key]) {
                                    return (
                                      <audio
                                        key={key}
                                        controls
                                        autoPlay
                                        src={audioBlobUrls[key]}
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-7 w-full max-w-[240px]"
                                      />
                                    );
                                  }
                                  const isLoading = loadingAudioKeys.has(key);
                                  const isError = audioErrorKeys.has(key);
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handlePlayAudio(key, file.url); }}
                                      disabled={isLoading}
                                      title={file.filename}
                                      className={`flex flex-shrink-0 items-center gap-1 text-[10px] sm:text-xs px-1.5 py-0.5 rounded border transition-colors max-w-[240px] truncate disabled:opacity-60 ${
                                        isError
                                          ? 'border-red-500/60 bg-red-900/20 text-red-300'
                                          : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60'
                                      }`}
                                    >
                                      <FiPlay size={11} className={`flex-shrink-0 ${isLoading ? 'animate-pulse' : ''}`} />
                                      <span className="truncate">{isError ? '再生に失敗（再試行）' : isLoading ? '読み込み中...' : file.filename}</span>
                                    </button>
                                  );
                                }
                                return (
                                  <a
                                    key={key}
                                    href={file.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex flex-shrink-0 items-center gap-1 text-[10px] sm:text-xs px-1.5 py-0.5 rounded border border-slate-600 bg-slate-800/60 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60 transition-colors max-w-[240px] truncate"
                                    title={file.filename}
                                  >
                                    <FiPaperclip size={11} className="flex-shrink-0" />
                                    <span className="truncate">{file.filename}</span>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 🌟 右側カラム: 提出期限 (右上固定・幅はテキスト分のみ確保) */}
                        <div className="flex-shrink-0 pt-0.5 text-right">
                          <div className={`flex flex-col items-end text-xs sm:text-sm font-medium ${status.color}`}>
                            <div className="flex items-center gap-1">
                              <FiCalendar size={13} className="mb-[1px]" />
                              <span>{formatDateTime(assignment.deadline)}</span>
                            </div>
                            {/* 「あと何日」などのラベル部分 */}
                            {status.label && <span className="text-[10px] sm:text-xs opacity-90 mt-0.5">{status.label}</span>}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* LMS未設定・エラー時のバナー */}
          {!isAdminMode && !hasLmsCredentials && (
            <div className="mb-6 p-4 bg-blue-900/40 border border-blue-500/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3 text-blue-200">
                <FiInfo className="mt-0.5 flex-shrink-0 text-blue-400" size={18} />
                <p className="text-sm">
                  LMSの課題を自動で取得するには、設定画面からLMSのIDとパスワードを登録してください。
                </p>
              </div>
              <Link
                to="?tab=setting&focus=advanced"
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors whitespace-nowrap self-end sm:self-auto"
              >
                設定を開く
              </Link>
            </div>
          )}

          {!isAdminMode && hasLmsCredentials && isLmsApiError && (
            <div className="mb-6 p-4 bg-red-900/40 border border-red-500/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3 text-red-200">
                <FiInfo className="mt-0.5 flex-shrink-0 text-red-400" size={18} />
                <p className="text-sm">
                  LMSへのログインに失敗しました。IDとパスワードが正しいか確認してください。
                </p>
              </div>
              <Link
                to="?tab=setting&focus=advanced"
                className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors whitespace-nowrap self-end sm:self-auto"
              >
                設定を確認
              </Link>
            </div>
          )}

          {/* 課題フォーム */}
          <div ref={formRef} className={`bg-slate-800/50 p-5 rounded-xl transition-all duration-300 ring-cyan-500 border border-slate-700 max-w-2xl mx-auto w-full ${editingId ? 'ring-2 shadow-lg shadow-cyan-500/10' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-md text-slate-200 flex items-center gap-2">
                {editingId ? <><FiEdit2 className="text-cyan-400" /> 課題を編集</> : <><FiPlus className="text-slate-400" /> {isAdminMode && userRole === 'admin' ? '新しい[公式]課題を追加' : '新しい個人課題を追加'}</>}
              </h3>
              {editingId && <Button size="xs" variant="subtle" color="gray" onClick={resetForm} leftSection={<FiX />}>キャンセル</Button>}
            </div>
            <form onSubmit={handleAddOrUpdateAssignment} className="space-y-2">
              <TextInput label="課題名" placeholder="例）中間レポート" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} required />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select label="科目" placeholder="科目を選択" data={subject.map(s => ({ value: s.id.toString(), label: s.name }))} value={newSubjectId} onChange={(value) => setNewSubjectId(value)} searchable nothingFoundMessage="科目が見つかりません" />
                <TextInput label="URL（任意）" placeholder="https://example.com" value={newUrl} onChange={(e) => setNewUrl(e.currentTarget.value)} leftSection={<FiLink size={16} />} />
              </SimpleGrid>
              <Group grow>
                <DatePickerInput label="期限日" placeholder="日付を選択" value={newDate} onChange={handleDateChange} locale="ja" valueFormat="YYYY/MM/DD" required firstDayOfWeek={0} getDayProps={getDayProps} />
                <TextInput label="時刻（任意）" type="time" value={newTime} onChange={(e) => setNewTime(e.currentTarget.value)} />
              </Group>
              <Group grow className="mt-6 max-w-md mx-auto">
                <Button type="submit" color={editingId ? "cyan" : "blue"} leftSection={editingId ? <FiEdit2 size={16} /> : <FiPlus size={16} />}>{editingId ? '更新を保存する' : (isAdminMode && userRole === 'admin' ? '公式課題として追加' : '個人課題を追加')}</Button>
              </Group>
            </form>
          </div>

        </div>
      </ChapterFrame>
    </div>
  );
};

export default Assignments;