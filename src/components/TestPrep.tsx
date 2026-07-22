/* src/components/TestPrep.tsx */

import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { FiCheckSquare, FiCheck, FiX, FiPlus, FiEdit2, FiTrash2, FiTool, FiArrowLeft, FiRefreshCw, FiHelpCircle, FiInbox, FiChevronRight, FiCheckCircle, FiXCircle, FiImage } from 'react-icons/fi';
import { Textarea, TextInput, Select, SegmentedControl, Radio, Button, Group, FileInput } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';

type Subject = { id: number; name: string };

type QuestionType = 'free_response' | 'multiple_choice';

type QuestionSet = 'past_exam' | 'predicted';

const QUESTION_SET_LABELS: Record<QuestionSet, string> = {
  past_exam: '過去問題',
  predicted: '予想問題',
};

const QUESTION_SET_BADGE_CLASSES: Record<QuestionSet, string> = {
  past_exam: 'bg-cyan-900/40 text-cyan-200 border-cyan-700/60',
  predicted: 'bg-amber-900/40 text-amber-200 border-amber-700/60',
};

type QuizQuestion = {
  id: number;
  subject_id: number;
  question: string;
  answer: string;
  question_type: QuestionType;
  choices: string[] | null;
  question_set: QuestionSet;
  explanation: string | null;
  image_urls: string[] | null;
};

type Deck = {
  key: string;
  subjectId: number;
  subjectName: string;
  questionSet: QuestionSet;
  questions: QuizQuestion[];
};

interface TestPrepProps { subject: Subject[] }

const shuffle = <T,>(items: T[]): T[] => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

type View = 'subjects' | 'session' | 'result';

const ResultBanner: React.FC<{ correct: boolean }> = ({ correct }) => (
  <div
    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 sm:px-4 sm:py-3 font-bold text-base sm:text-lg animate-in fade-in zoom-in-95 duration-300 ${
      correct
        ? 'border-teal-400 bg-teal-900/40 text-teal-100'
        : 'border-red-400 bg-red-900/40 text-red-100'
    }`}
  >
    {correct ? <FiCheckCircle size={22} /> : <FiXCircle size={22} />}
    {correct ? '正解！' : '不正解...'}
  </div>
);

const ExplanationBox: React.FC<{ explanation: string }> = ({ explanation }) => (
  <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 sm:p-4 animate-in fade-in duration-300">
    <p className="text-xs font-bold text-cyan-300 mb-1">解説</p>
    <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{explanation}</p>
  </div>
);

const TestPrep: React.FC<TestPrepProps> = ({ subject }) => {
  const queryClient = useQueryClient();

  // --- 管理者モード ---
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formSubjectId, setFormSubjectId] = useState<string | null>(null);
  const [formQuestionSet, setFormQuestionSet] = useState<QuestionSet>('past_exam');
  const [formQuestion, setFormQuestion] = useState('');
  const [formType, setFormType] = useState<QuestionType>('multiple_choice');
  const [formAnswer, setFormAnswer] = useState('');
  const [formChoices, setFormChoices] = useState<string[]>(['', '', '', '']);
  const [correctChoiceIndex, setCorrectChoiceIndex] = useState<number | null>(null);
  const [formExplanation, setFormExplanation] = useState('');
  const [formImageUrls, setFormImageUrls] = useState<string[]>([]);
  const [formImageFiles, setFormImageFiles] = useState<File[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // --- 出題セッション ---
  const [view, setView] = useState<View>('subjects');
  const [selectedDeckKey, setSelectedDeckKey] = useState<string | null>(null);
  const [sessionQuestions, setSessionQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState<number | null>(null);
  const [frAnswered, setFrAnswered] = useState<boolean | null>(null);
  const [results, setResults] = useState<boolean[]>([]);

  // --- データ取得 ---
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
        console.error('Profile fetch error:', error);
        return null;
      }
      return data;
    },
    enabled: !!currentUser?.id,
  });

  const userRole = userProfile?.role || 'user';

  const { data: quizQuestions = [], isLoading: isLoadingQuestions } = useQuery<QuizQuestion[]>({
    queryKey: ['quizQuestions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quiz_questions')
        .select('id, subject_id, question, answer, question_type, choices, question_set, explanation, image_urls')
        .order('id');
      if (error) {
        console.error('Error fetching quiz questions:', error);
        return [];
      }
      return data as QuizQuestion[];
    },
  });

  const loading = isLoadingUser || isLoadingProfile || isLoadingQuestions;

  const deckKey = (subjectId: number, questionSet: QuestionSet) => `${subjectId}:${questionSet}`;

  const questionsByDeck = useMemo(() => {
    const map: Record<string, QuizQuestion[]> = {};
    for (const q of quizQuestions) {
      const key = deckKey(q.subject_id, q.question_set);
      if (!map[key]) map[key] = [];
      map[key].push(q);
    }
    return map;
  }, [quizQuestions]);

  const decks = useMemo(() => {
    const result: Deck[] = [];
    const setOrder: QuestionSet[] = ['past_exam', 'predicted'];
    for (const s of subject) {
      for (const qs of setOrder) {
        const key = deckKey(s.id, qs);
        const questions = questionsByDeck[key];
        if (questions?.length) {
          result.push({ key, subjectId: s.id, subjectName: s.name, questionSet: qs, questions });
        }
      }
    }
    return result;
  }, [subject, questionsByDeck]);

  // --- 管理者用ミューテーション ---
  const upsertMutation = useMutation({
    mutationFn: async (payload: { isEdit: boolean; id?: number; data: any }) => {
      if (payload.isEdit) {
        const { error } = await supabase.from('quiz_questions').update(payload.data).eq('id', payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('quiz_questions').insert(payload.data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['quizQuestions'] });
      toast.success('問題を保存しました。');
    },
    onError: (error) => {
      console.error('Error saving quiz question:', error);
      toast.error('問題の保存に失敗しました。権限がありません。');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('quiz_questions').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizQuestions'] });
      toast.success('問題を削除しました。');
    },
    onError: (error) => {
      console.error('Error deleting quiz question:', error);
      toast.error('問題の削除に失敗しました。');
    },
  });

  const resetForm = () => {
    setEditingId(null);
    setFormSubjectId(null);
    setFormQuestionSet('past_exam');
    setFormQuestion('');
    setFormType('multiple_choice');
    setFormAnswer('');
    setFormChoices(['', '', '', '']);
    setCorrectChoiceIndex(null);
    setFormExplanation('');
    setFormImageUrls([]);
    setFormImageFiles([]);
  };

  const handleEditClick = (q: QuizQuestion) => {
    setEditingId(q.id);
    setFormSubjectId(q.subject_id.toString());
    setFormQuestionSet(q.question_set);
    setFormQuestion(q.question);
    setFormType(q.question_type);
    setFormExplanation(q.explanation ?? '');
    setFormImageUrls(q.image_urls ?? []);
    setFormImageFiles([]);
    if (q.question_type === 'multiple_choice' && q.choices) {
      setFormChoices(q.choices);
      const idx = q.choices.findIndex(c => c === q.answer);
      setCorrectChoiceIndex(idx >= 0 ? idx : null);
      setFormAnswer('');
    } else {
      setFormAnswer(q.answer);
      setFormChoices(['', '', '', '']);
      setCorrectChoiceIndex(null);
    }
  };

  const handleDeleteQuestion = (id: number) => {
    if (!window.confirm('本当にこの問題を削除しますか？')) return;
    deleteMutation.mutate(id);
  };

  const handleChoiceTextChange = (index: number, value: string) => {
    setFormChoices(prev => prev.map((c, i) => (i === index ? value : c)));
  };

  const handleSubmitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubjectId || !formQuestion) return;

    if (formType === 'multiple_choice' && (formChoices.some(c => !c.trim()) || correctChoiceIndex === null)) {
      toast.error('選択肢を4つとも入力し、正解を選んでください。');
      return;
    }
    if (formType === 'free_response' && !formAnswer) return;

    let imageUrls = formImageUrls;
    if (formImageFiles.length > 0) {
      setIsUploadingImage(true);
      try {
        const uploaded = await Promise.all(formImageFiles.map(async (file) => {
          const ext = file.name.split('.').pop();
          const path = `quiz/${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from('images').upload(path, file);
          if (uploadError) throw uploadError;
          return supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
        }));
        imageUrls = [...imageUrls, ...uploaded];
      } catch (err) {
        console.error('Error uploading image:', err);
        toast.error('画像のアップロードに失敗しました。');
        setIsUploadingImage(false);
        return;
      }
      setIsUploadingImage(false);
    }

    let data: Record<string, unknown>;
    if (formType === 'multiple_choice') {
      data = {
        subject_id: parseInt(formSubjectId, 10),
        question_set: formQuestionSet,
        question: formQuestion,
        question_type: 'multiple_choice',
        choices: formChoices,
        answer: formChoices[correctChoiceIndex as number],
        explanation: formExplanation || null,
        image_urls: imageUrls.length > 0 ? imageUrls : null,
      };
    } else {
      data = {
        subject_id: parseInt(formSubjectId, 10),
        question_set: formQuestionSet,
        question: formQuestion,
        question_type: 'free_response',
        choices: null,
        answer: formAnswer,
        explanation: formExplanation || null,
        image_urls: imageUrls.length > 0 ? imageUrls : null,
      };
    }

    if (editingId) {
      upsertMutation.mutate({ isEdit: true, id: editingId, data });
    } else {
      upsertMutation.mutate({ isEdit: false, data: { ...data, created_by: currentUser?.id ?? null } });
    }
  };

  // --- 出題セッション操作 ---
  const startSession = (key: string) => {
    const questions = shuffle(questionsByDeck[key] ?? []);
    setSelectedDeckKey(key);
    setSessionQuestions(questions);
    setCurrentIndex(0);
    setIsAnswerRevealed(false);
    setSelectedChoiceIndex(null);
    setFrAnswered(null);
    setResults([]);
    setView('session');
  };

  const restartSession = () => {
    if (selectedDeckKey === null) return;
    startSession(selectedDeckKey);
  };

  const backToSubjects = () => {
    setView('subjects');
    setSelectedDeckKey(null);
    setSessionQuestions([]);
    setCurrentIndex(0);
    setIsAnswerRevealed(false);
    setSelectedChoiceIndex(null);
    setFrAnswered(null);
    setResults([]);
  };

  const markAnswer = (correct: boolean) => {
    const nextResults = [...results, correct];
    setResults(nextResults);
    if (currentIndex + 1 >= sessionQuestions.length) {
      setView('result');
    } else {
      setCurrentIndex(currentIndex + 1);
      setIsAnswerRevealed(false);
      setSelectedChoiceIndex(null);
      setFrAnswered(null);
    }
  };

  const handleChoiceClick = (index: number) => {
    if (selectedChoiceIndex !== null) return;
    setSelectedChoiceIndex(index);
  };

  const handleFreeResponseAnswer = (correct: boolean) => {
    setFrAnswered(correct);
  };

  const handleNextQuestion = () => {
    const question = sessionQuestions[currentIndex];
    const correct = question.question_type === 'multiple_choice'
      ? question.choices?.[selectedChoiceIndex ?? -1] === question.answer
      : !!frAnswered;
    markAnswer(correct);
  };

  if (loading) return <Loading />;

  const selectedDeck = decks.find(d => d.key === selectedDeckKey);
  const selectedSubjectName = selectedDeck
    ? `${selectedDeck.subjectName}（${QUESTION_SET_LABELS[selectedDeck.questionSet]}）`
    : '';
  const currentQuestion = sessionQuestions[currentIndex];
  const correctCount = results.filter(Boolean).length;

  return (
    <div className={`transition-all duration-300 ${isAdminMode ? 'bg-yellow-900/30' : ''}`}>
      <ChapterFrame
        title={
          <div className="flex items-center w-full gap-2">
            <div className="flex-1 flex justify-start invisible pointer-events-none" aria-hidden="true">
              {userRole === 'admin' && (
                <Button variant="outline" size="xs" className="sm:px-4 sm:text-sm">
                  <div className="flex items-center justify-center">
                    <FiTool size={16} />
                    <span className="hidden sm:inline ml-2">{isAdminMode ? '通常モード' : '管理者モード'}</span>
                  </div>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <FiCheckSquare className={`text-2xl sm:text-3xl transition-colors ${isAdminMode ? 'text-yellow-400' : 'text-cyan-400'}`} />
              <span className={`font-orbitron font-bold text-glow text-xl sm:text-3xl whitespace-nowrap transition-colors ${isAdminMode ? 'text-yellow-400' : 'text-cyan-300'}`}>
                テスト対策
              </span>
            </div>
            <div className="flex-1 flex justify-end">
              {userRole === 'admin' && (
                <Button
                  onClick={() => { setIsAdminMode(prev => !prev); resetForm(); }}
                  variant="outline"
                  color={isAdminMode ? 'cyan' : 'yellow'}
                  size="xs"
                  className="sm:px-4 sm:text-sm"
                >
                  <div className="flex items-center justify-center">
                    <FiTool size={16} />
                    <span className="hidden sm:inline ml-2">{isAdminMode ? '通常モード' : '管理者モード'}</span>
                  </div>
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-8 p-1 sm:p-4 rounded-xl transition-all duration-300">

          {isAdminMode && userRole === 'admin' ? (
            <div className="flex flex-col gap-6">
              {/* 問題追加・編集フォーム */}
              <div className={`bg-slate-800/50 p-5 rounded-xl transition-all duration-300 ring-cyan-500 border border-slate-700 ${editingId ? 'ring-2 shadow-lg shadow-cyan-500/10' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-md text-slate-200 flex items-center gap-2">
                    {editingId ? <><FiEdit2 className="text-cyan-400" /> 問題を編集</> : <><FiPlus className="text-slate-400" /> 新しい問題を追加</>}
                  </h3>
                  {editingId && <Button size="xs" variant="subtle" color="gray" onClick={resetForm} leftSection={<FiX />}>キャンセル</Button>}
                </div>
                <form onSubmit={handleSubmitQuestion} className="space-y-3">
                  <Select
                    label="科目"
                    placeholder="科目を選択"
                    data={subject.map(s => ({ value: s.id.toString(), label: s.name }))}
                    value={formSubjectId}
                    onChange={setFormSubjectId}
                    searchable
                    nothingFoundMessage="科目が見つかりません"
                    required
                  />
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">問題セット</label>
                    <SegmentedControl
                      fullWidth
                      color="cyan"
                      value={formQuestionSet}
                      onChange={(value) => setFormQuestionSet(value as QuestionSet)}
                      data={[
                        { label: '過去問題', value: 'past_exam' },
                        { label: '予想問題', value: 'predicted' },
                      ]}
                    />
                  </div>
                  <Textarea label="問題文" placeholder="例）光合成が行われる細胞小器官は？" value={formQuestion} onChange={(e) => setFormQuestion(e.currentTarget.value)} autosize minRows={2} required />

                  <div>
                    <FileInput
                      label="画像（任意・複数選択可）"
                      placeholder="画像を選択"
                      accept="image/*"
                      multiple
                      value={formImageFiles}
                      onChange={(files) => setFormImageFiles(files ?? [])}
                      clearable
                      leftSection={<FiImage size={16} />}
                    />
                    {(formImageUrls.length > 0 || formImageFiles.length > 0) && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formImageUrls.map((url, i) => (
                          <div key={`existing-${i}`} className="relative inline-block">
                            <img src={url} alt="プレビュー" className="max-h-32 rounded-lg border border-slate-700 object-contain" />
                            <button
                              type="button"
                              onClick={() => setFormImageUrls(prev => prev.filter((_, idx) => idx !== i))}
                              className="absolute -top-2 -right-2 bg-slate-800 border border-slate-600 rounded-full p-1 text-slate-300 hover:text-red-400 hover:border-red-400 transition-colors"
                              aria-label="画像を削除"
                            >
                              <FiX size={14} />
                            </button>
                          </div>
                        ))}
                        {formImageFiles.map((file, i) => (
                          <div key={`new-${i}`} className="relative inline-block">
                            <img src={URL.createObjectURL(file)} alt="プレビュー" className="max-h-32 rounded-lg border border-slate-700 object-contain" />
                            <button
                              type="button"
                              onClick={() => setFormImageFiles(prev => prev.filter((_, idx) => idx !== i))}
                              className="absolute -top-2 -right-2 bg-slate-800 border border-slate-600 rounded-full p-1 text-slate-300 hover:text-red-400 hover:border-red-400 transition-colors"
                              aria-label="画像を削除"
                            >
                              <FiX size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">出題形式</label>
                    <SegmentedControl
                      fullWidth
                      color="cyan"
                      value={formType}
                      onChange={(value) => setFormType(value as QuestionType)}
                      data={[
                        { label: '4択', value: 'multiple_choice' },
                        { label: '自由記述', value: 'free_response' },
                      ]}
                    />
                  </div>

                  {formType === 'free_response' ? (
                    <Textarea label="解答" placeholder="例）葉緑体" value={formAnswer} onChange={(e) => setFormAnswer(e.currentTarget.value)} autosize minRows={2} required />
                  ) : (
                    <Radio.Group
                      label="選択肢（正解を選択）"
                      color="cyan"
                      value={correctChoiceIndex !== null ? correctChoiceIndex.toString() : ''}
                      onChange={(value) => setCorrectChoiceIndex(parseInt(value, 10))}
                    >
                      <div className="flex flex-col gap-2 mt-2">
                        {formChoices.map((choice, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Radio value={i.toString()} />
                            <TextInput
                              className="flex-1"
                              placeholder={`選択肢${i + 1}`}
                              value={choice}
                              onChange={(e) => handleChoiceTextChange(i, e.currentTarget.value)}
                              required
                            />
                          </div>
                        ))}
                      </div>
                    </Radio.Group>
                  )}

                  <Textarea
                    label="解説（任意）"
                    placeholder="例）光合成はチラコイド膜で行われ、葉緑体がその場となる。"
                    value={formExplanation}
                    onChange={(e) => setFormExplanation(e.currentTarget.value)}
                    autosize
                    minRows={2}
                  />

                  <Group grow className="mt-2 max-w-md mx-auto">
                    <Button type="submit" color={editingId ? 'cyan' : 'blue'} loading={isUploadingImage || upsertMutation.isPending} leftSection={editingId ? <FiEdit2 size={16} /> : <FiPlus size={16} />}>
                      {editingId ? '更新を保存する' : '問題を追加'}
                    </Button>
                  </Group>
                </form>
              </div>

              {/* 既存問題一覧 */}
              <div className="flex flex-col gap-3">
                {decks.map(deck => {
                  const qs = deck.questions;
                  return (
                    <div key={deck.key} className="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
                      <h4 className="text-sm font-bold text-cyan-300 mb-2">
                        {deck.subjectName}
                        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border align-middle ${QUESTION_SET_BADGE_CLASSES[deck.questionSet]}`}>
                          {QUESTION_SET_LABELS[deck.questionSet]}
                        </span>
                        <span className="ml-2 text-slate-400 font-normal">（{qs.length}問）</span>
                      </h4>
                      <div className="flex flex-col gap-2">
                        {qs.map(q => (
                          <div key={q.id} className="flex items-start justify-between gap-3 bg-slate-900/40 rounded-lg p-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${q.question_type === 'multiple_choice' ? 'bg-purple-900/30 text-purple-300 border-purple-800/50' : 'bg-cyan-900/30 text-cyan-300 border-cyan-800/50'}`}>
                                  {q.question_type === 'multiple_choice' ? '4択' : '自由記述'}
                                </span>
                                {q.image_urls && q.image_urls.length > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 bg-slate-700/40 text-slate-300 border-slate-600/50">
                                    <FiImage size={10} /> 画像{q.image_urls.length > 1 ? ` x${q.image_urls.length}` : ''}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-200 truncate">{q.question}</p>
                              {q.question_type === 'multiple_choice' && q.choices ? (
                                <p className="text-xs text-slate-500 truncate">選択肢: {q.choices.join(' / ')}（正解: {q.answer}）</p>
                              ) : (
                                <p className="text-xs text-slate-500 truncate">答え: {q.answer}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => handleEditClick(q)} className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-700/80 rounded transition-colors"><FiEdit2 size={14} /></button>
                              <button onClick={() => handleDeleteQuestion(q.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-700/80 rounded transition-colors"><FiTrash2 size={14} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {quizQuestions.length === 0 && (
                  <div className="text-center py-10 px-4 bg-slate-800/30 rounded-lg border border-slate-700/30">
                    <FiInbox size={32} className="mx-auto text-slate-500 mb-3" />
                    <p className="text-slate-400 text-sm">まだ問題が登録されていません</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {view === 'subjects' && (
                decks.length === 0 ? (
                  <div className="text-center py-10 px-4 bg-slate-800/30 rounded-lg border border-slate-700/30">
                    <FiInbox size={32} className="mx-auto text-slate-500 mb-3" />
                    <p className="text-slate-400 text-sm">まだ出題できる科目はありません</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 w-full">
                    {decks.map(deck => (
                      <button
                        key={deck.key}
                        onClick={() => startSession(deck.key)}
                        className="group flex items-center gap-2 sm:gap-3 w-full p-3 sm:p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-cyan-500 hover:bg-slate-800 transition-all text-left"
                      >
                        <FiHelpCircle className="text-cyan-400 flex-shrink-0" size={20} />
                        <span className="flex-1 min-w-0 min-w-0">
                          <span className="block font-bold text-slate-100 group-hover:text-cyan-300 group-hover:underline underline-offset-4 transition-colors truncate">
                            {deck.subjectName}
                          </span>
                          <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded border ${QUESTION_SET_BADGE_CLASSES[deck.questionSet]}`}>
                            {QUESTION_SET_LABELS[deck.questionSet]}
                          </span>
                        </span>
                        <span className="flex-shrink-0 text-xs text-slate-400">{deck.questions.length}問</span>
                        <FiChevronRight className="flex-shrink-0 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" size={18} />
                      </button>
                    ))}
                  </div>
                )
              )}

              {view === 'session' && currentQuestion && (
                <div className="flex flex-col gap-3 sm:gap-6 w-full max-w-xl mx-auto">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <button onClick={backToSubjects} className="flex items-center gap-1 text-xs! sm:text-sm! text-slate-400 hover:text-cyan-300 transition-colors flex-shrink-0">
                      <FiArrowLeft size={12} /> 科目選択に戻る
                    </button>
                    <span className="text-xs sm:text-sm font-medium text-slate-400 truncate">{selectedSubjectName} ({currentIndex + 1} / {sessionQuestions.length})</span>
                  </div>

                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 sm:p-6 min-h-[100px] sm:min-h-[160px] flex flex-col items-center justify-center gap-2 sm:gap-4">
                    {currentQuestion.image_urls && currentQuestion.image_urls.length > 0 && (
                      <div className={`grid gap-2 w-full ${currentQuestion.image_urls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {currentQuestion.image_urls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt="問題画像"
                            className="max-h-40 sm:max-h-56 w-full max-w-full rounded-lg object-contain mx-auto"
                          />
                        ))}
                      </div>
                    )}
                    <p className="w-full text-base sm:text-lg font-bold text-slate-100 text-center whitespace-pre-wrap break-words">{currentQuestion.question}</p>
                    {currentQuestion.question_type === 'free_response' && isAnswerRevealed && (
                      <p className="w-full text-cyan-300 text-center whitespace-pre-wrap break-words animate-in fade-in duration-300">{currentQuestion.answer}</p>
                    )}
                  </div>

                  {currentQuestion.question_type === 'multiple_choice' ? (
                    <div className="flex flex-col gap-2 sm:gap-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {(currentQuestion.choices ?? []).map((choice, i) => {
                          const isSelected = selectedChoiceIndex === i;
                          const isCorrectChoice = choice === currentQuestion.answer;
                          const showResult = selectedChoiceIndex !== null;
                          let stateClasses = 'border-slate-700 bg-slate-800/60 text-slate-100 hover:border-cyan-500';
                          if (showResult && isCorrectChoice) stateClasses = 'border-teal-400 bg-teal-900/50 text-teal-100 shadow-md shadow-teal-500/10';
                          else if (showResult && isSelected) stateClasses = 'border-red-400 bg-red-900/50 text-red-100 shadow-md shadow-red-500/10';
                          return (
                            <button
                              key={i}
                              onClick={() => handleChoiceClick(i)}
                              disabled={showResult}
                              className={`p-4 sm:p-5 text-[13px]! sm:text-base! rounded-xl border font-medium transition-colors disabled:cursor-default flex items-center justify-between gap-2 ${stateClasses}`}
                            >
                              <span className="text-left min-w-0 break-words">{choice}</span>
                              {showResult && isCorrectChoice && (
                                <FiCheckCircle className="flex-shrink-0 animate-in zoom-in duration-300" size={18} />
                              )}
                              {showResult && isSelected && !isCorrectChoice && (
                                <FiXCircle className="flex-shrink-0 animate-in zoom-in duration-300" size={18} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {selectedChoiceIndex !== null && (
                        <>
                          <ResultBanner correct={currentQuestion.choices?.[selectedChoiceIndex] === currentQuestion.answer} />
                          {currentQuestion.explanation && <ExplanationBox explanation={currentQuestion.explanation} />}
                          <Button onClick={handleNextQuestion} size="md" color="blue" rightSection={<FiChevronRight size={16} />}>
                            {currentIndex + 1 >= sessionQuestions.length ? '結果を見る' : '次の問題へ'}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : !isAnswerRevealed ? (
                    <Button onClick={() => setIsAnswerRevealed(true)} size="md" color="blue">答えを見る</Button>
                  ) : frAnswered === null ? (
                    <Group grow>
                      <Button onClick={() => handleFreeResponseAnswer(false)} color="red" variant="outline" leftSection={<FiX size={16} />}>不正解</Button>
                      <Button onClick={() => handleFreeResponseAnswer(true)} color="teal" leftSection={<FiCheck size={16} />}>正解</Button>
                    </Group>
                  ) : (
                    <div className="flex flex-col gap-2 sm:gap-4">
                      <ResultBanner correct={frAnswered} />
                      {currentQuestion.explanation && <ExplanationBox explanation={currentQuestion.explanation} />}
                      <Button onClick={handleNextQuestion} size="md" color="blue" rightSection={<FiChevronRight size={16} />}>
                        {currentIndex + 1 >= sessionQuestions.length ? '結果を見る' : '次の問題へ'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {view === 'result' && (
                <div className="flex flex-col items-center gap-6 w-full max-w-xl mx-auto text-center">
                  <FiCheckSquare className="text-cyan-400" size={40} />
                  <h3 className="text-2xl font-bold text-slate-100">{selectedSubjectName} の結果</h3>
                  <p className="text-3xl font-bold text-cyan-300">{correctCount} / {sessionQuestions.length} 問正解</p>
                  <Group grow className="w-full">
                    <Button onClick={backToSubjects} variant="outline" color="gray" leftSection={<FiArrowLeft size={16} />}>科目選択に戻る</Button>
                    <Button onClick={restartSession} color="blue" leftSection={<FiRefreshCw size={16} />}>もう一度</Button>
                  </Group>
                </div>
              )}
            </>
          )}

        </div>
      </ChapterFrame>
    </div>
  );
};

export default TestPrep;
