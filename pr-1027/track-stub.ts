export const trackAnalyticsEvent = (name: string, props: unknown) => { ((window as any).events ??= []).push([name, props]); };
