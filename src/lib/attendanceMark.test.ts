import { describe, it, expect } from 'vitest';
import { cmidFromUrl, parseOpenSessions, parseSessionForm } from './attendanceMark';

// 実際の LMS の出欠画面（受け付け中の回があるとき）の形
const VIEW = `<div class="attendance_mobile_view_page">
    <core-course-module-info [module]="module" description="" component="mod_attendance" componentId="104960" [courseId]="courseId">
    </core-course-module-info>
    <ion-item>
        <ion-label>
            <h2>2026/11/25 (水) 12:30PM - 12:50PM</h2>
            <h3></h3>
            <ion-button core-site-plugins-new-content component="mod_attendance" method="mobile_user_form" [args]="{cmid: 104960, courseid: 4135, sessid: 80422, timestamp: 1795577261}" [preSets]="{getFromCache: 0, saveToCache: 0}" refreshOnSuccess="true" samePage="true">
                {{ 'plugin.mod_attendance.submitattendance' | translate }}
            </ion-button>
        </ion-label>
    </ion-item>
    <ion-item><ion-label><ion-grid><ion-row>
      <ion-col size="9">{{ 'plugin.mod_attendance.sessionscompleted' | translate }}</ion-col><ion-col size="2">1</ion-col>
    </ion-row></ion-grid></ion-label></ion-item>
</div>`;

const FORM = `<div class="attendance_mobile_user_form">
    <ion-item>
        <ion-label>{{ 'plugin.mod_attendance.enterpassword' | translate }}:</ion-label>
        <ion-input type="text" name="studentpass" [(ngModel)]="studentpass"></ion-input>
    </ion-item>
    <ion-radio-group [(ngModel)]="status" name="status">
    </ion-radio-group>
    <ion-button class="ion-margin" expand="block" core-site-plugins-new-content component="mod_attendance" method="mobile_view_activity" [args]="{cmid: 104960, courseid: 4135, sessid: 80423, status: status, studentpass: studentpass}">
    </ion-button>
</div>`;

describe('parseOpenSessions（受け付け中の回を探す）', () => {
  it('「出席を送信」ボタンの値と日時を取り出す', () => {
    expect(parseOpenSessions(VIEW)).toEqual([
      { cmid: 104960, courseid: 4135, sessid: 80422, timestamp: 1795577261, label: '2026/11/25 (水) 12:30PM - 12:50PM' },
    ]);
  });
  it('受け付け中の回がなければ空', () => {
    expect(parseOpenSessions(VIEW.replace(/<ion-button[\s\S]*?<\/ion-button>/, ''))).toEqual([]);
  });
});

describe('parseSessionForm（入力画面）', () => {
  it('パスワードの欄があり、選択肢がない', () => {
    expect(parseSessionForm(FORM)).toEqual({ needsPassword: true, statuses: [] });
  });
  it('出欠の状態の選択肢を取り出す', () => {
    const html = FORM.replace('</ion-radio-group>', '<ion-item><ion-label>出席</ion-label><ion-radio value="11"></ion-radio></ion-item><ion-item><ion-label>遅刻</ion-label><ion-radio value="12"></ion-radio></ion-item></ion-radio-group>');
    expect(parseSessionForm(html).statuses).toEqual([{ id: '11', label: '出席' }, { id: '12', label: '遅刻' }]);
  });
});

describe('cmidFromUrl', () => {
  it('出席ページの URL から id を取り出す', () => {
    expect(cmidFromUrl('https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=104960')).toBe(104960);
    expect(cmidFromUrl('https://lms-tokyo.iput.ac.jp/course/view.php?id=4135')).toBeNull();
  });
});
