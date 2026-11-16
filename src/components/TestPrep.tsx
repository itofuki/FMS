/* src/components/TestPrep.tsx */

import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { FiCheckSquare, FiCheck, FiX, FiPlus, FiEdit2, FiTrash2, FiTool, FiArrowLeft, FiRefreshCw, FiHelpCircle, FiInbox, FiChevronRight, FiCheckCircle, FiXCircle, FiImage } from 'react-icons/fi';
import { Textarea, TextInput, Select, SegmentedControl, Radio, Button, Group, FileInput } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserProfile } from '../hooks/useUserProfile';
import { toast } from 'sonner';

type Subject = { id: number; name: string };

type QuestionType = 'free_response' | 'multiple_choice';

type QuestionSet = 'past_exam' | 'predicted';

const QUESTION_SET_LABELS: Record<QuestionSet, string> = {
  past_exam: '過去問題',
  predicted: '予想問題',
};

const QUESTION_SET_BADGE_CLASSES: Record<QuestionSet, string> = {
  past_exam: 'bg-accent-soft text-accent border-accent/60',
  predicted: 'bg-warn-soft text-warn border-warn/60',
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
        ? 'border-accent bg-accent-soft text-accent'
        : 'border-down bg-down-soft text-down'
    }`}
  >
    {correct ? <FiCheckCircle size={22} /> : <FiXCircle size={22} />}
    {correct ? '正解！' : '不正解...'}
  </div>
);

const ExplanationBox: React.FC<{ explanation: string }> = ({ explanation }) => (
  <div className="rounded-xl border border-line bg-surface-2/60 p-3 sm:p-4 animate-in fade-in duration-300">
    <p className="text-xs font-bold text-accent mb-1">解説</p>
    <p className="text-sm text-fg whitespace-pre-wrap break-words">{explanation}</p>
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
  const { currentUser, userRole, isLoading: isLoadingProfile } = useUserProfile();

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

  const loading = isLoadingProfile || isLoadingQuestions;

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
    mutationFn: async (payload: { isEdit: boolean; id?: number; data: Record<string, unknown> }) => {
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

  // 科目選択の一覧（管理者モードでないとき）は、外側のカードを付けずに課題ページと同じ2列にする
  const isSubjectList = !(isAdminMode && userRole === 'admin') && view === 'subjects';
  const adminToggle = (
          // 課題ページと同じく、管理者モードはひと目で分かるよう黄色
          <button
            type="button"
            onClick={() => { setIsAdminMode(prev => !prev); resetForm(); }}
            aria-pressed={isAdminMode}
            aria-label={isAdminMode ? '管理者モードを終了' : '管理者モード'}
            title={isAdminMode ? '管理者モードを終了' : '管理者モード'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold transition-colors ${
              isAdminMode
                ? 'bg-amber-400 border-amber-400 text-slate-900 hover:bg-amber-300'
                : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 dark:bg-amber-400/10 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-400/20'
            }`}
          >
            <FiTool size={13} />
            {/* Mantine の CSS が button の文字指定を上書きするため、文字は span 側で指定する */}
            <span className="text-xs font-bold">{isAdminMode ? '終了' : '管理者モード'}</span>
          </button>
  );

  return (
    <div>
      <ChapterFrame
        icon={FiCheckSquare}
        title="テスト対策"
        bare={isSubjectList}
        meta={isAdminMode && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-slate-900 text-xs font-bold"><FiTool size={12} />管理者モード</span>}
        actions={userRole === 'admin' && !isSubjectList && adminToggle}
      >
        <div className="w-full flex flex-col gap-6">

          {isAdminMode && userRole === 'admin' ? (
            <div className="flex flex-col gap-6">
              {/* 問題追加・編集フォーム */}
              <div className={`bg-surface-2/50 p-5 rounded-xl transition-all duration-300 ring-accent border border-line ${editingId ? 'ring-2 shadow-lg' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-md text-fg flex items-center gap-2">
                    {editingId ? <><FiEdit2 className="text-accent" /> 問題を編集</> : <><FiPlus className="text-fg-muted" /> 新しい問題を追加</>}
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
                    <label className="block text-sm font-medium text-fg-muted mb-1">問題セット</label>
                    <SegmentedControl
                      fullWidth
                      color="brand"
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
                            <img src={url} alt="プレビュー" className="max-h-32 rounded-lg border border-line object-contain" />
                            <button
                              type="button"
                              onClick={() => setFormImageUrls(prev => prev.filter((_, idx) => idx !== i))}
                              className="absolute -top-2 -right-2 bg-surface-2 border border-line rounded-full p-1 text-fg-muted hover:text-down hover:border-down transition-colors"
                              aria-label="画像を削除"
                            >
                              <FiX size={14} />
                            </button>
                          </div>
                        ))}
                        {formImageFiles.map((file, i) => (
                          <div key={`new-${i}`} className="relative inline-block">
                            <img src={URL.createObjectURL(file)} alt="プレビュー" className="max-h-32 rounded-lg border border-line object-contain" />
                            <button
                              type="button"
                              onClick={() => setFormImageFiles(prev => prev.filter((_, idx) => idx !== i))}
                              className="absolute -top-2 -right-2 bg-surface-2 border border-line rounded-full p-1 text-fg-muted hover:text-down hover:border-down transition-colors"
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
                    <label className="block text-sm font-medium text-fg-muted mb-1">出題形式</label>
                    <SegmentedControl
                      fullWidth
                      color="brand"
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
                      color="brand"
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
                    <Button type="submit" color="brand" loading={isUploadingImage || upsertMutation.isPending} leftSection={editingId ? <FiEdit2 size={16} /> : <FiPlus size={16} />}>
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
                    <div key={deck.key} className="bg-surface-2 border border-line rounded-lg p-4">
                      <h4 className="text-sm font-bold text-accent mb-2">
                        {deck.subjectName}
                        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border align-middle ${QUESTION_SET_BADGE_CLASSES[deck.questionSet]}`}>
                          {QUESTION_SET_LABELS[deck.questionSet]}
                        </span>
                        <span className="ml-2 text-fg-muted font-normal">（{qs.length}問）</span>
                      </h4>
                      <div className="flex flex-col gap-2">
                        {qs.map(q => (
                          <div key={q.id} className="flex items-start justify-between gap-3 bg-surface rounded-lg p-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${q.question_type === 'multiple_choice' ? 'bg-link/10 text-link border-link/30' : 'bg-accent-soft text-accent border-accent/30'}`}>
                                  {q.question_type === 'multiple_choice' ? '4択' : '自由記述'}
                                </span>
                                {q.image_urls && q.image_urls.length > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 bg-surface-3 text-fg-muted border-line">
                                    <FiImage size={10} /> 画像{q.image_urls.length > 1 ? ` x${q.image_urls.length}` : ''}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-fg truncate">{q.question}</p>
                              {q.question_type === 'multiple_choice' && q.choices ? (
                                <p className="text-xs text-fg-subtle truncate">選択肢: {q.choices.join(' / ')}（正解: {q.answer}）</p>
                              ) : (
                                <p className="text-xs text-fg-subtle truncate">答え: {q.answer}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => handleEditClick(q)} className="p-1.5 text-fg-muted hover:text-accent hover:bg-surface-3/80 rounded transition-colors"><FiEdit2 size={14} /></button>
                              <button onClick={() => handleDeleteQuestion(q.id)} className="p-1.5 text-fg-muted hover:text-down hover:bg-surface-3/80 rounded transition-colors"><FiTrash2 size={14} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {quizQuestions.length === 0 && (
                  <div className="text-center py-10 px-4 bg-surface-2 rounded-lg border border-line">
                    <FiInbox size={32} className="mx-auto text-fg-subtle mb-3" />
                    <p className="text-fg-muted text-sm">まだ問題が登録されていません</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {view === 'subjects' && (
                // 課題ページと同じく「科目ごとの小見出し＋1件ずつのカード」、広い画面では右に概要の列
                <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
                  <aside className="mb-6 xl:mb-0 xl:mt-[52px] xl:order-2 xl:sticky xl:top-4 bg-surface border border-line">
                    <div className="px-4 sm:px-5 py-4 border-b border-line">
                      <p className="text-sm font-bold text-fg-muted">問題集の概要</p>
                      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
                        <dt className="text-fg-muted">科目</dt>
                        <dd className="font-bold text-fg text-right">{new Set(decks.map(d => d.subjectId)).size}</dd>
                        <dt className="text-fg-muted">問題の合計</dt>
                        <dd className="font-bold text-fg text-right">{decks.reduce((n, d) => n + d.questions.length, 0)}問</dd>
                      </dl>
                    </div>
                    <p className="px-4 sm:px-5 py-4 text-sm text-fg-muted leading-relaxed">
                      問題集を選ぶと、1問ずつ答えと解説を確認しながら進められます。
                    </p>
                  </aside>

                  <div className="xl:order-1 min-w-0 xl:px-6">
                    {/* 一覧の見出し行: 左に件数、右に管理者モード（課題ページと同じ位置） */}
                    <div className="flex items-center justify-between gap-3 mb-4 min-h-9">
                      <span className="text-sm text-fg-muted">問題集 <span className="text-base font-bold text-fg">{decks.length}</span>セット</span>
                      {userRole === 'admin' && adminToggle}
                    </div>
                    {decks.length === 0 ? (
                      <div className="text-center py-12 px-4 bg-surface border border-line rounded-lg">
                        <FiInbox size={28} className="mx-auto text-fg-subtle mb-2" />
                        <p className="text-fg-muted text-sm">まだ出題できる科目はありません</p>
                      </div>
                    ) : (
                      Array.from(new Map(decks.map(d => [d.subjectId, d.subjectName])).entries()).map(([subjectId, subjectName]) => {
                        const subjectDecks = decks.filter(d => d.subjectId === subjectId);
                        return (
                          <section key={subjectId} className="mb-6 last:mb-0">
                            <h3 className="flex items-center gap-2 mb-3 px-1 text-base font-bold text-fg">
                              <span className="w-1 h-4 rounded-full bg-accent" aria-hidden="true" />
                              {subjectName}
                              <span className="text-sm font-normal text-fg-muted">{subjectDecks.length}セット</span>
                            </h3>
                            <ul className="flex flex-col gap-3">
                              {subjectDecks.map(deck => (
                                <li key={deck.key}>
                                  <button
                                    onClick={() => startSession(deck.key)}
                                    className="group w-full flex items-center gap-4 px-4 sm:px-5 py-4 rounded-xl shadow-sm bg-surface hover:shadow-md transition-shadow text-left"
                                  >
                                    <FiHelpCircle className="text-accent flex-shrink-0" size={22} />
                                    <span className="flex-1 min-w-0">
                                      <span className={`inline-block text-xs px-1.5 py-0.5 rounded border ${QUESTION_SET_BADGE_CLASSES[deck.questionSet]}`}>
                                        {QUESTION_SET_LABELS[deck.questionSet]}
                                      </span>
                                      <span className="block mt-1 text-[17px] font-bold text-fg leading-snug truncate">
                                        {subjectName}の{QUESTION_SET_LABELS[deck.questionSet]}
                                      </span>
                                      <span className="block mt-0.5 text-sm text-fg-muted">{deck.questions.length}問</span>
                                    </span>
                                    <span className="flex-shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-full bg-accent-soft text-accent group-hover:bg-accent-solid group-hover:text-on-accent transition-colors">
                                      <span className="text-sm font-bold">始める</span>
                                      <FiChevronRight size={16} />
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {view === 'session' && currentQuestion && (
                <div className="flex flex-col gap-3 sm:gap-6 w-full max-w-xl mx-auto">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <button onClick={backToSubjects} className="flex items-center gap-1 text-xs! sm:text-sm! text-fg-muted hover:text-accent transition-colors flex-shrink-0">
                      <FiArrowLeft size={12} /> 科目選択に戻る
                    </button>
                    <span className="text-xs sm:text-sm font-medium text-fg-muted truncate">{selectedSubjectName} ({currentIndex + 1} / {sessionQuestions.length})</span>
                  </div>

                  <div className="bg-surface-2/60 border border-line rounded-xl p-4 sm:p-6 min-h-[100px] sm:min-h-[160px] flex flex-col items-center justify-center gap-2 sm:gap-4">
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
                    <p className="w-full text-base sm:text-lg font-bold text-fg text-center whitespace-pre-wrap break-words">{currentQuestion.question}</p>
                    {currentQuestion.question_type === 'free_response' && isAnswerRevealed && (
                      <p className="w-full text-accent text-center whitespace-pre-wrap break-words animate-in fade-in duration-300">{currentQuestion.answer}</p>
                    )}
                  </div>

                  {currentQuestion.question_type === 'multiple_choice' ? (
                    <div className="flex flex-col gap-2 sm:gap-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {(currentQuestion.choices ?? []).map((choice, i) => {
                          const isSelected = selectedChoiceIndex === i;
                          const isCorrectChoice = choice === currentQuestion.answer;
                          const showResult = selectedChoiceIndex !== null;
                          let stateClasses = 'border-line bg-surface-2/60 text-fg hover:border-accent';
                          if (showResult && isCorrectChoice) stateClasses = 'border-accent bg-accent-soft text-accent shadow-md';
                          else if (showResult && isSelected) stateClasses = 'border-down bg-down-soft text-down shadow-md';
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
                          <Button onClick={handleNextQuestion} size="md" color="brand" rightSection={<FiChevronRight size={16} />}>
                            {currentIndex + 1 >= sessionQuestions.length ? '結果を見る' : '次の問題へ'}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : !isAnswerRevealed ? (
                    <Button onClick={() => setIsAnswerRevealed(true)} size="md" color="brand">答えを見る</Button>
                  ) : frAnswered === null ? (
                    <Group grow>
                      <Button onClick={() => handleFreeResponseAnswer(false)} color="red" variant="outline" leftSection={<FiX size={16} />}>不正解</Button>
                      <Button onClick={() => handleFreeResponseAnswer(true)} color="green" leftSection={<FiCheck size={16} />}>正解</Button>
                    </Group>
                  ) : (
                    <div className="flex flex-col gap-2 sm:gap-4">
                      <ResultBanner correct={frAnswered} />
                      {currentQuestion.explanation && <ExplanationBox explanation={currentQuestion.explanation} />}
                      <Button onClick={handleNextQuestion} size="md" color="brand" rightSection={<FiChevronRight size={16} />}>
                        {currentIndex + 1 >= sessionQuestions.length ? '結果を見る' : '次の問題へ'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {view === 'result' && (
                <div className="flex flex-col items-center gap-6 w-full max-w-xl mx-auto text-center">
                  <FiCheckSquare className="text-accent" size={40} />
                  <h3 className="text-2xl font-bold text-fg">{selectedSubjectName} の結果</h3>
                  <p className="text-3xl font-bold text-accent">{correctCount} / {sessionQuestions.length} 問正解</p>
                  <Group grow className="w-full">
                    <Button onClick={backToSubjects} variant="outline" color="gray" leftSection={<FiArrowLeft size={16} />}>科目選択に戻る</Button>
                    <Button onClick={restartSession} color="brand" leftSection={<FiRefreshCw size={16} />}>もう一度</Button>
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
