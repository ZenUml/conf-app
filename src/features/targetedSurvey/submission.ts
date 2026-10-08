import { callRemote } from '@/utils/requestUtil';

export function createSurveySubmission(
  survey: { uuid: string; revision: number },
  remote: typeof callRemote = callRemote,
) {
  const submissionId = crypto.randomUUID();
  let pending: Promise<{ ok: boolean }> | null = null;
  return {
    send(options: string[], text: string): Promise<{ ok: boolean }> {
      if (pending) return pending;
      const payload = {
        surveyUuid: survey.uuid,
        revision: survey.revision,
        submissionId,
        options: [...options],
        text,
      };
      pending = remote('/api/targeted-survey', 'POST', payload).then((raw) => {
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (body?.ok !== true) throw new Error('SurveySaveResponseError');
        return { ok: true };
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
