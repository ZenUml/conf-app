import type { Meta, StoryObj } from '@storybook/vue3-vite';
import TargetedSurveyBanner from './TargetedSurveyBanner.vue';

const survey = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70',
  revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  title: 'Help us improve ZenUML',
  question: 'What could we improve?',
  options: [
    { id: 'performance', label: 'Loading or responsiveness' },
    { id: 'editing', label: 'Editing diagrams' },
    { id: 'display', label: 'Display or layout' },
    { id: 'export', label: 'Exporting or sharing' },
    { id: 'missing_feature', label: 'A feature I need is missing' },
    { id: 'other', label: 'Something else' },
  ],
};

const meta: Meta<typeof TargetedSurveyBanner> = {
  title: 'Page banner/TargetedSurveyBanner',
  component: TargetedSurveyBanner,
  parameters: { layout: 'fullscreen' },
  args: { survey, terminalKey: 'storybook:synthetic-user:survey', previewInitialPhase: 'invite' },
};

export default meta;
type Story = StoryObj<typeof TargetedSurveyBanner>;
export const Invitation: Story = {};
export const FeedbackForm: Story = { args: { previewInitialPhase: 'form' } };
