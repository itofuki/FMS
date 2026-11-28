import { describe, it, expect } from 'vitest';
import { assignCmidFromUrl, judgeSubmission, toAssignInfo, toSubmissionState } from './assignSubmit';

describe('課題の提出', () => {
  it('課題ページの URL から cmid を取り出す', () => {
    expect(assignCmidFromUrl('https://lms-tokyo.iput.ac.jp/mod/assign/view.php?id=104772')).toBe(104772);
    expect(assignCmidFromUrl('https://lms-tokyo.iput.ac.jp/mod/quiz/view.php?id=1')).toBeNull();
  });

  it('課題の設定（実際の LMS の形）', () => {
    const a = toAssignInfo({
      id: 17215, cmid: 104772, name: '日報', duedate: 1795737300, submissiondrafts: 0, requiresubmissionstatement: 0,
      configs: [
        { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '1' },
        { plugin: 'file', subtype: 'assignsubmission', name: 'maxfilesubmissions', value: '20' },
        { plugin: 'file', subtype: 'assignsubmission', name: 'maxsubmissionsizebytes', value: '524288000' },
        { plugin: 'file', subtype: 'assignsubmission', name: 'filetypeslist', value: '' },
      ],
    });
    expect(a).toMatchObject({ id: 17215, maxFiles: 20, maxBytes: 524288000, fileEnabled: true, textEnabled: false, drafts: false });
  });

  it('グループで提出する課題は、グループの提出の状態とファイルを見る', () => {
    const files = (n: string) => [{ type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: n, fileurl: 'u', filesize: 3 }] }] }];
    const s = toSubmissionState({ lastattempt: { canedit: true, submissiongroup: 5,
      submission: { status: 'new', plugins: [] },
      teamsubmission: { status: 'submitted', plugins: files('group.pdf') } } });
    expect(s).toMatchObject({ status: 'submitted', groupId: 5, files: [{ filename: 'group.pdf' }] });
  });

  it('提出済みのファイルを取り出す', () => {
    const s = toSubmissionState({ lastattempt: { canedit: true, submission: { status: 'submitted', plugins: [
      { type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: 'a.pdf', fileurl: 'u', filesize: 3 }] }] },
      { type: 'comments' },
    ] } } });
    expect(s).toMatchObject({ status: 'submitted', canEdit: true, files: [{ filename: 'a.pdf' }] });
  });

  it('提出のあと: 状態とファイル名がそろえば成功', () => {
    const after = { status: 'submitted', gradingStatus: null, groupId: null, canEdit: true, canSubmit: false, files: [{ filename: 'b.pdf', fileurl: '', filesize: 1 }, { filename: 'a.pdf', fileurl: '', filesize: 1 }], timemodified: 1 };
    expect(judgeSubmission(after, ['a.pdf', 'b.pdf'], false, false)).toBe(true);
    expect(judgeSubmission(after, ['a.pdf'], false, false)).toBe(false);
    expect(judgeSubmission({ ...after, status: 'draft' }, ['a.pdf', 'b.pdf'], false, false)).toBe(false);
    // 「提出」ボタンを押す方式で、確定まではしないとき
    expect(judgeSubmission({ ...after, status: 'draft' }, ['a.pdf', 'b.pdf'], true, false)).toBe(true);
  });
});
