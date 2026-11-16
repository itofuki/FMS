/* src/components/Feedback.tsx */

import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import ChapterFrame from './ChapterFrame';
import { FiMessageSquare, FiSend } from 'react-icons/fi';
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
    <ChapterFrame icon={FiMessageSquare} title="ご意見・ご要望">
      <div className="flex flex-col items-center justify-center p-2 sm:p-4">
        <div className="w-full max-w-2xl bg-surface border border-line rounded-xl shadow-sm p-4 md:p-8">
          <p className="text-fg-muted text-sm md:text-base mb-6 text-center">
            MyFMSをより良くするためのアイデア、バグの報告、追加してほしい機能など、自由にお書きください。
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Textarea
              placeholder="例：〇〇の機能が使いにくい。△△の機能を追加してほしい。"
              minRows={5}
              autosize
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
              disabled={isSubmitting}
            />

            <Button
              type="submit"
              color="brand"
              size="md"
              loading={isSubmitting}
              disabled={!content.trim()}
              leftSection={<FiSend />}
              className="mt-2 w-full sm:w-auto self-center"
            >
              送信する
            </Button>
          </form>

          {message && (
            <div
              className={`mt-6 p-4 rounded-md text-sm text-center font-medium ${
                message.type === 'success'
                  ? 'bg-up-soft text-up border border-up/50'
                  : 'bg-down-soft text-down border border-down/50'
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