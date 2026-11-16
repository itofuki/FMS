/* src/components/Feedback.tsx */

import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import { FiMessageSquare, FiSend, FiInfo } from 'react-icons/fi';
import { Textarea, Button } from '@mantine/core';

const Feedback = () => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    
    setIsSubmitting(true);
    setMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('feedback')
        .insert({
          user_id: user?.id || null, // ログインしていない場合はnull（設定次第）
          content: content.trim(),
        });

      if (error) throw error;

      setMessage({ type: 'success', text: '貴重なご意見ありがとうございます！送信が完了しました。' });
      setContent(''); // フォームをクリア
    } catch (error) {
      console.error('Feedback submission error:', error);
      setMessage({ type: 'error', text: '送信に失敗しました。時間をおいて再度お試しください。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ChapterFrame title="ご意見・ご要望" bare>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
        {/* 右の列: 送信について */}
        <aside className="mb-6 xl:mb-0 xl:order-2 xl:sticky xl:top-4 bg-surface border border-line px-4 sm:px-5 py-4">
          <p className="text-sm font-bold text-fg-muted flex items-center gap-1.5"><FiInfo size={14} />送信について</p>
          <ul className="mt-2 space-y-2 text-sm text-fg-muted leading-relaxed list-disc pl-4">
            <li>内容は開発者だけが確認します。</li>
            <li>ログイン中のアカウントと一緒に送信されます。</li>
            <li>個別の返信はできません。</li>
            <li>不具合の報告は「どの画面で」「何をしたら」「どうなったか」を書いてもらえると助かります。</li>
          </ul>
        </aside>

        {/* 左: 入力フォーム（1枚のカード） */}
        <div className="xl:order-1 min-w-0 xl:px-6">
          <form onSubmit={handleSubmit} className="rounded-xl shadow-sm bg-surface px-5 sm:px-6 py-5">
            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
              <FiMessageSquare className="text-accent" size={18} />
              ご意見・ご要望を送る
            </h3>
            <p className="mt-1.5 text-[15px] text-fg-muted leading-relaxed">
              FMS をより良くするためのアイデア、不具合の報告、追加してほしい機能など、自由にお書きください。
            </p>
            <Textarea
              className="mt-4"
              placeholder="例：〇〇の機能が使いにくい。△△の機能を追加してほしい。"
              minRows={6}
              autosize
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
              disabled={isSubmitting}
              aria-label="ご意見・ご要望"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-fg-subtle">{content.trim().length}文字</span>
              <Button
                type="submit"
                color="brand"
                loading={isSubmitting}
                disabled={!content.trim()}
                leftSection={<FiSend />}
              >
                送信する
              </Button>
            </div>
          </form>

          {message && (
            <div
              role="status"
              className={`mt-4 px-4 py-3 rounded-lg text-sm font-medium border ${
                message.type === 'success' ? 'bg-up-soft text-up border-up/40' : 'bg-down-soft text-down border-down/40'
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default Feedback;