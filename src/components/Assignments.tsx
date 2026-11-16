/* src/components/Assignments.tsx */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { FiPlus, FiTrash2, FiInbox, FiFileText, FiTool, FiLink, FiEdit2, FiX, FiInfo, FiRefreshCw, FiPaperclip, FiPlay, FiExternalLink, FiMoreVertical, FiAlertTriangle } from 'react-icons/fi';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ja } from 'date-fns/locale';
import { TextInput, Select, Button, Group, SimpleGrid, Menu, ActionIcon } from '@mantine/core';
import { DatePickerInput, type DayProps } from '@mantine/dates';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import 'dayjs/locale/ja';
import { toast } from 'sonner';
import DOMPurify from 'dompurify';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useUserProfile } from '../hooks/useUserProfile';
import { useLmsEvents } from '../hooks/useLmsEvents';
import { useDbAssignments, useDbSubjects, useLmsStatuses } from '../hooks/useAssignmentSources';
import { withLmsToken } from '../lib/lms';
import {
  getDeadlineStatus, mergeAssignments, groupAssignments, ASSIGNMENT_GROUP_LABELS, type AssignmentGroupKey,
  type Assignment, type Subject, type LmsStatus, type UnifiedAssignment,
} from '../lib/assignments';

interface AssignmentsProps { subject: Subject[] }

type AssignmentPayload = {
  name: string;
  deadline: string;
  subject_id: number | null;
  url: string | null;
  classification?: 'official' | 'private';
  user_id?: string;
};

// --- ヘルパー関数 ---
const formatDateTime = (isoString: string) => {
  if (!isoString) return '';
  return format(new Date(isoString), "MM/dd HH:mm");
};
const today = new Date();
today.setHours(0, 0, 0, 0);


// 残り時間のタグ（掲示板の「強く買いたい」タグの位置）
const deadlineTag = (deadline: string) => {
  const remaining = new Date(deadline).getTime() - Date.now();
  const { label } = getDeadlineStatus(deadline, false);
  const text = label.replace(/[()]/g, '');
  // 控えめな見た目（薄い背景＋色文字＋細い枠＋小さな点）。カードの縁にまたがって載せるので、
  // 背景には透けない色（*-soft / surface はいずれも不透明）を使う
  if (remaining < 0) return { label: '期限切れ', className: 'bg-down-soft text-down border-down/50', dot: 'bg-down' };
  if (remaining <= 24 * 60 * 60 * 1000) return { label: text, className: 'bg-down-soft text-down border-down/40', dot: 'bg-down' };
  if (remaining <= 3 * 24 * 60 * 60 * 1000) return { label: text, className: 'bg-warn-soft text-warn border-warn/40', dot: 'bg-warn' };
  return { label: text, className: 'bg-surface text-fg-muted border-line-strong', dot: 'bg-fg-subtle' };
};

// ダークモードの課題カードの色（配色変更前の元の課題カードの色: 通常 slate-700/80・公式 slate-800・完了 slate-800/60）
const rowDarkBg = (a: UnifiedAssignment) =>
  a.done ? 'dark:bg-slate-800/60'
  : a.classification === 'official' && !a.isLms ? 'dark:bg-slate-800'
  : 'dark:bg-slate-700/80';

// お知らせの帯（左に色の線とアイコン、要点と補足、右端に操作）
const NOTICE_STYLE = {
  info: { box: 'bg-accent-soft border-accent/30', bar: 'bg-accent', icon: 'text-accent' },
  danger: { box: 'bg-down-soft border-down/30', bar: 'bg-down', icon: 'text-down' },
} as const;
const NOTICE_ACTION_CLASS = {
  info: 'inline-flex items-center justify-center h-9 px-4 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent text-sm font-bold whitespace-nowrap transition-colors',
  // 赤の塗りボタンはライト・ダークどちらでも白文字が読める red-600 で固定（ダークの --down は明るすぎるため）
  danger: 'inline-flex items-center justify-center h-9 px-4 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-bold whitespace-nowrap transition-colors disabled:opacity-60',
} as const;

function NoticeBar({ tone, title, description, action }: { tone: keyof typeof NOTICE_STYLE; title: string; description: string; action: React.ReactNode }) {
  const st = NOTICE_STYLE[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`relative flex flex-col sm:flex-row sm:items-center gap-3 pl-5 pr-4 py-3 rounded-lg border overflow-hidden ${st.box}`}>
      <span className={`absolute left-0 inset-y-0 w-1 ${st.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {tone === 'danger' ? <FiAlertTriangle className={`mt-0.5 flex-shrink-0 ${st.icon}`} size={18} /> : <FiInfo className={`mt-0.5 flex-shrink-0 ${st.icon}`} size={18} />}
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-fg">{title}</p>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
      </div>
      <div className="flex-shrink-0 self-end sm:self-auto">{action}</div>
    </div>
  );
}

// グループの色（期限が近いほど強い色）。進み具合バーと小見出しの印で共通
const GROUP_STYLE: Record<AssignmentGroupKey, { bar: string }> = {
  done: { bar: 'bg-up' },
  overdue: { bar: 'bg-down' },
  today: { bar: 'bg-down/60' },
  week: { bar: 'bg-warn' },
  later: { bar: 'bg-line-strong' },
};
// 進み具合バーの並び（完了を左端に）
const SUMMARY_ORDER: AssignmentGroupKey[] = ['done', 'overdue', 'today', 'week', 'later'];


const Assignments: React.FC<AssignmentsProps> = ({ subject }) => {
  const queryClient = useQueryClient();

  // --- ローカルステート ---
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newTime, setNewTime] = useState('');
  const [newSubjectId, setNewSubjectId] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  // 追加フォームは「追加」ボタンを押したときだけ開く（掲示板の「投稿する」と同じく一覧の上）
  const [isFormOpen, setIsFormOpen] = useState(false);
  // 完了にした直後の課題を、元のグループにしばらく残す（押した結果を目で確かめられるように）
  const LINGER_MS = 1200;
  const [lingering, setLingering] = useState<Set<string>>(() => new Set());
  const lingerTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = lingerTimers.current;
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);
  // 「LMS 同期：〇分前」の表示を30秒ごとに更新するための時計
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // 完了した課題は普段は畳んでおく
  const [showDone, setShowDone] = useState(false);

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
  const { currentUser, userRole, isLoading: isLoadingProfile } = useUserProfile();

  const { data: assignments = [], isLoading: isLoadingAssignments } = useDbAssignments();

  const {
    data: lmsEvents = [], isLoading: isLoadingLmsEvents, isFetching: isFetchingLmsEvents,
    isError: isLmsApiError, isTokenExpired, hasLmsSession, session: lmsSession, forceFullRefresh,
    dataUpdatedAt: lmsDataUpdatedAt, isPlaceholderData: isLmsPlaceholder,
  } = useLmsEvents();

  const { data: dbSubjects = [], isLoading: isLoadingDbSubjects } = useDbSubjects();
  const { data: lmsStatuses = [], isLoading: isLoadingLmsStatuses } = useLmsStatuses(currentUser?.id);

  const loading = isLoadingProfile || isLoadingAssignments || isLoadingLmsEvents || isLoadingDbSubjects || isLoadingLmsStatuses;

  // --- React Queryによるデータ更新 (Mutations) ---
  const upsertMutation = useMutation({
    mutationFn: async (payload: { isEdit: boolean, data: AssignmentPayload, id?: number }) => {
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
    if (date.getDay() === 6) { styles.color = 'var(--link)'; }
    if (date.getTime() === today.getTime()) {
      styles.outline = '2px solid var(--accent)';
      styles.outlineOffset = '-2px';
    }
    return { style: styles };
  };

  const handleDateChange = (value: Date | string | null) => {
    if (!value) {
      setNewDate(null);
      return;
    }
    setNewDate(new Date(value));
  };

  const resetForm = () => {
    setIsFormOpen(false);
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
      const updatePayload: AssignmentPayload = {
        name: newName,
        deadline: deadlineForSupabase,
        subject_id: newSubjectId ? parseInt(newSubjectId, 10) : null,
        url: newUrl || null,
      };
      upsertMutation.mutate({ isEdit: true, id: editingId, data: updatePayload });
    } else {
      const newAssignment: AssignmentPayload = {
        name: newName,
        deadline: deadlineForSupabase,
        subject_id: newSubjectId ? parseInt(newSubjectId, 10) : null,
        classification: isOfficial ? 'official' : 'private',
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

  const stopLingering = (key: string) => {
    const t = lingerTimers.current.get(key);
    if (t) window.clearTimeout(t);
    lingerTimers.current.delete(key);
    setLingering(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleCheck = (assignment: UnifiedAssignment) => {
    const key = String(assignment.id);
    const title = assignment.name.replace(/[「」]|の提出期限/g, '');
    const isDone = assignment.done || lingering.has(key);
    if (!isDone) {
      handleToggleDone(assignment.id, false, assignment.isLms);
      setLingering(prev => new Set(prev).add(key));
      lingerTimers.current.set(key, window.setTimeout(() => stopLingering(key), LINGER_MS));
      toast.success(`「${title}」を完了にしました`, {
        duration: 5000,
        action: {
          label: '元に戻す',
          onClick: () => { stopLingering(key); handleToggleDone(assignment.id, true, assignment.isLms); },
        },
      });
    } else {
      stopLingering(key);
      handleToggleDone(assignment.id, true, assignment.isLms);
      toast(`「${title}」を未完了に戻しました`);
    }
  };

  const handleForceRefreshLms = forceFullRefresh;

  // 添付ファイルのURLにはトークンを保存していないため、開く直前に付与する
  const attachmentUrl = (url: string) => (lmsSession ? withLmsToken(url, lmsSession.token) : url);

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

  const unifiedAssignments = useMemo(() => mergeAssignments({
    assignments,
    lmsEvents,
    dbSubjects,
    subjects: subject,
    lmsStatuses,
    officialOnly: isAdminMode && userRole === 'admin',
  }), [assignments, lmsEvents, dbSubjects, subject, isAdminMode, userRole, lmsStatuses]);

  if (loading) return <Loading />;

  const isOfficialMode = isAdminMode && userRole === 'admin';
  const cleanTitle = (title: string) => title.replace(/[「」]|の提出期限/g, '');
  const pendingCount = unifiedAssignments.filter(a => !a.done).length;
  const groups = groupAssignments(unifiedAssignments);
  // 一覧の表示用: 完了にした直後の課題は、しばらく元のグループに残す
  // （未完了として並べ直すので、残している間は元の位置のまま動かない）
  const displayGroups = lingering.size === 0 ? groups : groupAssignments(
    unifiedAssignments
      .map(a => (lingering.has(String(a.id)) ? { ...a, done: false } : a))
      .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : new Date(a.deadline).getTime() - new Date(b.deadline).getTime())),
  );
  const groupCounts = Object.fromEntries(
    (['overdue', 'today', 'week', 'later', 'done'] as AssignmentGroupKey[]).map(k => [k, groups.find(g => g.key === k)?.items.length ?? 0]),
  ) as Record<AssignmentGroupKey, number>;
  const doneCount = groupCounts.done;
  const showForm = isFormOpen || editingId !== null;
  // LMS を最後に取得できた時刻（「2分前」のように表示。キャッシュ表示中はまだ取得していない）
  const lmsSyncedLabel = !lmsDataUpdatedAt || isLmsPlaceholder
    ? (isFetchingLmsEvents ? '取得中…' : '未取得')
    : nowTick - lmsDataUpdatedAt < 60_000
      ? 'たった今'
      : formatDistanceToNowStrict(lmsDataUpdatedAt, { locale: ja, addSuffix: true });

  /**
   * 課題1件（掲示板のコメントの構成をコンパクトにしたもの。アイコンは置かない）
   *   左: 丸い完了チェック（ToDo の定番の形）
   *   中央 1行目: 科目名・種別・締切・残り時間 ／ 2行目: 課題名（リンクなら押すと開く） ／ 3行目: 説明・添付
   *   右端: 「⋯」メニュー（編集・削除）。チェックと「⋯」はどちらもカードの上下中央
   */
  const renderRow = (assignment: UnifiedAssignment) => {
    const key = String(assignment.id);
    const isLingering = lingering.has(key);
    // 表示上の完了状態（残している間も完了として見せる）
    const isDone = assignment.done || isLingering;
    const canDelete = !assignment.isLms && (isOfficialMode || (assignment.classification === 'private' && assignment.user_id === currentUser?.id));
    const subjectName = assignment.subject_name || '未分類';
    const title = cleanTitle(assignment.name);
    const hasAttachments = assignment.isLms && !!assignment.attachments?.length;
    const tag = isDone ? null : deadlineTag(assignment.deadline);
    const titleClass = `text-[17px] sm:text-lg font-bold leading-snug break-words ${isDone ? 'text-fg-subtle line-through' : 'text-fg'}`;

    // 左の丸いチェック（ToDo の定番の形）。見た目は 24px、押せる範囲は 44px 四方
    const doneCheck = (
      <button
        type="button"
        onClick={() => handleCheck(assignment)}
        aria-pressed={isDone}
        aria-label={isDone ? `${title} を未完了に戻す` : `${title} を完了にする`}
        title={isDone ? '未完了に戻す' : '完了にする'}
        className="group/check flex-shrink-0 -m-2.5 p-2.5 rounded-full"
      >
        {/* 押した瞬間: 緑に塗られて一度ふくらみ、チェックの線が描かれる */}
        <motion.span
          key={isDone ? 'on' : 'off'}
          initial={isDone ? { scale: 0.6 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 14 }}
          className={`flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors ${
            isDone
              ? 'bg-up border-up text-white'
              : 'border-line-strong group-hover/check:border-up group-hover/check:bg-up-soft'
          }`}
        >
          {isDone && (
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, delay: 0.05 }} />
            </svg>
          )}
        </motion.span>
      </button>
    );

    const moreMenu = canDelete ? (
      <Menu position="bottom-end" withinPortal shadow="md" width={140}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label="その他の操作">
            <FiMoreVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<FiEdit2 size={14} />} onClick={() => handleEditClick(assignment)}>編集</Menu.Item>
          <Menu.Item color="red" leftSection={<FiTrash2 size={14} />} onClick={() => handleDeleteAssignment(assignment.id, assignment.isLms)}>削除</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    ) : null;

    return (
      <motion.li
        key={key}
        layout="position"
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.25 } }}
        transition={{ layout: { duration: 0.3, ease: 'easeOut' } }}
        className={`relative flex items-start gap-3.5 px-4 sm:px-5 py-4 rounded-xl shadow-sm transition-[box-shadow,background-color] duration-300 ${
          editingId === assignment.id ? 'bg-accent-soft ring-2 ring-accent'
          : isLingering ? 'bg-up-soft ring-1 ring-up/30'
          : `bg-surface hover:shadow-md ${rowDarkBg(assignment)}`
        }`}
      >
        {/* 残り時間のバッジは、カードの右上の角に上の縁にまたがるように載せる。
            右端は「⋮」と同じ right-2 にそろえ、角の丸み（12px）の内側に収める */}
        {tag && (
          <span className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold whitespace-nowrap ${tag.className}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${tag.dot}`} aria-hidden="true" />
            {tag.label}
          </span>
        )}

        {/* 「⋮」はカードの右端・上下中央に */}
        {moreMenu && <div className="absolute right-2 top-1/2 -translate-y-1/2">{moreMenu}</div>}

        {/* 左: 完了チェック（カードの上下中央） */}
        <div className="self-center">{doneCheck}</div>

        {/* 右端の「⋮」と重ならないよう、本文全体の右側を空ける */}
        <div className={`flex-1 min-w-0 transition-opacity duration-300 ${moreMenu ? 'pr-9' : ''} ${isDone ? 'opacity-70' : ''}`}>
          {/* 1行目: 科目・種別・締切・残り時間 */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <span className="font-semibold text-link truncate max-w-[60%]">{subjectName}</span>
            {assignment.isLms && <span className="text-xs text-fg-subtle">LMS</span>}
            {!assignment.isLms && assignment.classification === 'official' && (
              <span className="text-xs px-1.5 rounded bg-warn-soft text-warn font-semibold">公式</span>
            )}
            {assignment.submissionStatus === 'draft' && (
              <span className="text-xs px-1.5 rounded bg-accent-soft text-accent font-semibold">下書き</span>
            )}
            <span className="text-fg-muted whitespace-nowrap">締切 {formatDateTime(assignment.deadline)}</span>
          </div>

          {/* 2行目: 課題名（リンクがあれば押すと開く） */}
          {assignment.url ? (
            <a
              href={assignment.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-2 inline-flex items-start gap-1.5 hover:text-link hover:underline ${titleClass}`}
            >
              <span className="line-clamp-2">{title}</span>
              <FiExternalLink size={14} className="mt-1.5 flex-shrink-0 text-fg-subtle" aria-label="新しいタブで開く" />
            </a>
          ) : (
            <p className={`mt-2 line-clamp-2 ${titleClass}`}>{title}</p>
          )}

          {/* 3行目: 説明（1行）と添付 */}
          {((assignment.isLms && assignment.description) || hasAttachments) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              {assignment.isLms && assignment.description && (
                <div
                  className="min-w-0 flex-1 basis-60 text-sm leading-relaxed line-clamp-2 text-fg-muted"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(assignment.description) }}
                />
              )}
              {hasAttachments && assignment.attachments!.map((file, i) => {
                const key = `${assignment.id}_${i}`;
                const chip = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border max-w-[240px] transition-colors';
                if (isAudioFile(file.filename)) {
                  if (audioBlobUrls[key]) {
                    return <audio key={key} controls autoPlay src={audioBlobUrls[key]} className="h-8 w-full max-w-[260px]" />;
                  }
                  const isLoading = loadingAudioKeys.has(key);
                  const isError = audioErrorKeys.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePlayAudio(key, attachmentUrl(file.url))}
                      disabled={isLoading}
                      title={file.filename}
                      className={`${chip} disabled:opacity-60 ${isError ? 'border-down/40 bg-down-soft text-down' : 'border-line text-fg-muted hover:text-accent hover:border-accent/50'}`}
                    >
                      <FiPlay size={11} className={`flex-shrink-0 ${isLoading ? 'animate-pulse' : ''}`} />
                      <span className="text-xs truncate">{isError ? '再生に失敗（再試行）' : isLoading ? '読み込み中...' : file.filename}</span>
                    </button>
                  );
                }
                return (
                  <a
                    key={key}
                    href={attachmentUrl(file.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={file.filename}
                    className={`${chip} border-line text-fg-muted hover:text-accent hover:border-accent/50`}
                  >
                    <FiPaperclip size={11} className="flex-shrink-0" />
                    <span className="text-xs truncate">{file.filename}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

      </motion.li>
    );
  };

  // LMS の状態のお知らせ（カードの外、操作行のすぐ下に1行で出す）
  const lmsNotice = isAdminMode ? null : !hasLmsSession ? (
    <NoticeBar
      tone="info"
      title="LMSの課題はまだ表示されていません"
      description="設定画面からLMSにログインすると、課題を自動で取得します。"
      action={<Link to="?tab=setting&focus=advanced" className={NOTICE_ACTION_CLASS.info}>LMSにログイン</Link>}
    />
  ) : isLmsApiError ? (
    isTokenExpired ? (
      <NoticeBar
        tone="danger"
        title="LMSのログイン有効期限が切れました"
        description="表示中のLMSの課題は最新ではない可能性があります。"
        action={<Link to="?tab=setting&focus=advanced" className={NOTICE_ACTION_CLASS.danger}>再ログイン</Link>}
      />
    ) : (
      <NoticeBar
        tone="danger"
        title="LMSの課題を取得できませんでした"
        description="通信状況を確認して、もう一度お試しください。"
        action={
          <button type="button" onClick={handleForceRefreshLms} disabled={isFetchingLmsEvents} className={NOTICE_ACTION_CLASS.danger}>
            {isFetchingLmsEvents ? '再試行中...' : '再試行'}
          </button>
        }
      />
    )
  ) : null;

  const openNewForm = () => {
    resetForm();
    setIsFormOpen(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };

  return (
    <ChapterFrame
      icon={FiFileText}
      title="課題"
      bare
      notice={lmsNotice}
    >
      {/* 画面が広い（xl 以上）ときは、ヤフーファイナンスの掲示板のように「左に一覧・右に補足」の2列にする。
          課題カードが横に間延びしないようにし、進み具合はスクロールしても右に残す */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-6 xl:items-start">
        <aside className="mb-6 xl:mb-0 xl:order-2 xl:sticky xl:top-4">
          <div className="bg-surface border border-line">
            {/* 上段: LMS の同期状態と更新 */}
            <div className="px-4 sm:px-6 xl:px-5 py-3 flex flex-col gap-2 text-sm border-b border-line">
              {hasLmsSession ? (
                <div className="flex items-center justify-between gap-2">
                  <span className={isLmsApiError ? 'text-down font-semibold' : 'text-fg-muted'}>
                    {isLmsApiError ? 'LMS 同期エラー' : `LMS 同期：${lmsSyncedLabel}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleForceRefreshLms}
                    disabled={isFetchingLmsEvents}
                    title={isFetchingLmsEvents ? 'LMS同期中...' : 'LMSの提出状況を今すぐ更新'}
                    aria-label="LMSの提出状況を今すぐ更新"
                    className="relative inline-flex items-center gap-1.5 px-2 py-1 -mr-2 rounded-md text-fg-muted hover:text-accent hover:bg-surface-3 disabled:cursor-not-allowed transition-colors"
                  >
                    <FiRefreshCw size={14} className={isFetchingLmsEvents ? 'animate-spin' : ''} />
                    <span className="text-xs font-semibold">{isFetchingLmsEvents ? '更新中' : '更新'}</span>
                    {isLmsApiError && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-down ring-2 ring-surface" aria-hidden="true" />}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">LMS 未接続</span>
                  <Link to="?tab=setting&focus=advanced" className="text-xs font-semibold text-link hover:underline">ログイン</Link>
                </div>
              )}
            </div>

            {/* 下段: 進み具合（掲示板の「みんなの評価」の割合バーのように、全体の状況をひと目で） */}
            {unifiedAssignments.length > 0 && (
              <div className="px-4 sm:px-6 xl:px-5 py-5">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <span className="text-base font-bold text-fg">進み具合</span>
                  <span className="text-sm text-fg-muted">
                    完了 <span className="text-2xl font-bold text-up">{doneCount}</span> / {unifiedAssignments.length}件
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`全${unifiedAssignments.length}件中${doneCount}件完了`}>
                  {SUMMARY_ORDER.map(key => {
                    const n = groupCounts[key];
                    return n > 0 ? <div key={key} className={`${GROUP_STYLE[key].bar} transition-[width] duration-500 ease-out`} style={{ width: `${(n / unifiedAssignments.length) * 100}%` }} /> : null;
                  })}
                </div>
                <ul className="mt-3 flex flex-wrap xl:flex-col gap-x-5 gap-y-1.5 xl:gap-y-2 text-sm text-fg-muted">
                  {SUMMARY_ORDER.map(key => (
                    <li key={key} className="inline-flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${GROUP_STYLE[key].bar}`} />
                      {ASSIGNMENT_GROUP_LABELS[key]}
                      <span className="font-semibold text-fg">{groupCounts[key]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
        <div className="xl:order-1 min-w-0">
          {/* 一覧の見出し行: 左に件数、右に追加（どこに追加されるかが分かるよう一覧のすぐ上に置く） */}
          <div className="flex items-center justify-between gap-3 mb-4 px-3 sm:px-8 xl:px-0">
            <div className="flex items-center gap-2 min-w-0 text-sm text-fg-muted">
              {isAdminMode ? (
                <>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-slate-900 text-xs font-bold whitespace-nowrap"><FiTool size={12} />管理者モード</span>
                  <span className="hidden sm:inline">公式課題のみ表示中</span>
                </>
              ) : (
                <span>未完了 <span className="text-base font-bold text-fg">{pendingCount}</span>件</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* 管理者モード: 切り替えると一覧と「追加」の動きが変わるので、そのすぐ隣に置く（管理者にだけ表示） */}
              {userRole === 'admin' && (
                <button
                  type="button"
                  onClick={() => { setIsAdminMode(prev => !prev); resetForm(); }}
                  aria-pressed={isAdminMode}
                  aria-label={isAdminMode ? '管理者モードを終了' : '管理者モード'}
                  title={isAdminMode ? '管理者モードを終了' : '管理者モード'}
                  className={`inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-md border text-sm font-bold transition-colors ${
                    isAdminMode
                      ? 'bg-amber-400 border-amber-400 text-slate-900 hover:bg-amber-300'
                      : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 dark:bg-amber-400/10 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-400/20'
                  }`}
                >
                  <FiTool size={15} />
                  {/* Mantine の CSS が button の文字指定を上書きするため、文字は span 側で指定する */}
                  <span className="hidden sm:inline text-sm font-bold">{isAdminMode ? '終了' : '管理者モード'}</span>
                </button>
              )}
              <Button onClick={openNewForm} leftSection={<FiPlus size={16} />}>
                {isOfficialMode ? '公式課題を追加' : '課題を追加'}
              </Button>
            </div>
          </div>
      {/* 追加・編集フォーム（一覧の上に開く） */}
      {showForm && (
        <div ref={formRef} className="mb-5 p-4 sm:p-5 bg-surface border border-line rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-fg flex items-center gap-2">
              {editingId ? <><FiEdit2 className="text-accent" /> 課題を編集</> : <><FiPlus className="text-accent" /> {isOfficialMode ? '新しい[公式]課題' : '新しい個人課題'}</>}
            </h3>
            <Button size="xs" variant="subtle" color="gray" onClick={resetForm} leftSection={<FiX />}>閉じる</Button>
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
            <div className="flex justify-end pt-2">
              <Button type="submit" color="brand" leftSection={editingId ? <FiEdit2 size={16} /> : <FiPlus size={16} />}>
                {editingId ? '更新を保存する' : (isOfficialMode ? '公式課題として追加' : '個人課題を追加')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 一覧: 期限の近さで小見出しを付けて区切る */}
      {unifiedAssignments.length === 0 ? (
        <div className="text-center py-12 px-4 bg-surface border border-line rounded-lg">
          <FiInbox size={28} className="mx-auto text-fg-subtle mb-2" />
          <p className="text-fg-muted text-sm">{isAdminMode ? '表示できる公式課題はありません' : '直近2週間の課題はありません 🎉'}</p>
        </div>
      ) : (
        displayGroups.map(group => {
          const collapsed = group.key === 'done' && !showDone;
          return (
            <section key={group.key} className="mb-6 last:mb-0 px-3 sm:px-8 xl:px-0">
              <h3 className="flex items-center gap-2 mb-4 px-1 text-base font-bold text-fg">
                <span className={`w-1 h-4 rounded-full ${GROUP_STYLE[group.key].bar}`} aria-hidden="true" />
                {group.label}
                <span className="text-sm font-normal text-fg-muted">{group.items.length}件</span>
                {group.key === 'done' && (
                  <button
                    type="button"
                    onClick={() => setShowDone(v => !v)}
                    className="ml-auto text-sm font-semibold text-link hover:underline"
                  >
                    {collapsed ? '表示する' : '隠す'}
                  </button>
                )}
              </h3>
              {!collapsed && (
                <MotionConfig reducedMotion="user">
                  <ul className="flex flex-col gap-5">
                    <AnimatePresence initial={false}>
                      {group.items.map(renderRow)}
                    </AnimatePresence>
                  </ul>
                </MotionConfig>
              )}
            </section>
          );
        })
      )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default Assignments;