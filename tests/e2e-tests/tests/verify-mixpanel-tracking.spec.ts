import { test, expect } from '@playwright/test';

test.describe('Mixpanel Tracking Verification', () => {
  test('should track view_macro event with event_category=graph', async ({ page }) => {
    const mixpanelEvents: any[] = [];

    // Intercept Mixpanel API calls
    await page.route('**/*mixpanel.com/**', async (route) => {
      const request = route.request();
      const url = request.url();

      // Capture the request data
      if (url.includes('track') || url.includes('engage')) {
        const postData = request.postData();
        console.log('Mixpanel request:', url);
        if (postData) {
          try {
            const data = JSON.parse(postData);
            console.log('Mixpanel data:', JSON.stringify(data, null, 2));
            mixpanelEvents.push(data);
          } catch (e) {
            // Try to decode if base64
            try {
              const decoded = Buffer.from(postData, 'base64').toString('utf-8');
              const data = JSON.parse(decoded);
              console.log('Mixpanel decoded data:', JSON.stringify(data, null, 2));
              mixpanelEvents.push(data);
            } catch (e2) {
              console.log('Raw Mixpanel data:', postData);
            }
          }
        }
      }

      // Continue the request
      await route.continue();
    });

    // Also listen to console logs from the page
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('view_macro') || text.includes('trackEvent')) {
        console.log('Browser console:', text);
      }
    });

    // Navigate to a page with a graph diagram on staging
    // We'll use the test page created during smoke tests
    await page.goto('https://zenuml-stg.atlassian.net/wiki/spaces/ZS/pages/566001816');

    // Wait for the page to load and the macro to render
    await page.waitForLoadState('networkidle');

    // Wait a bit for Mixpanel to send events
    await page.waitForTimeout(3000);

    // Check if we captured any view_macro events with event_category=graph
    console.log(`\n\nCaptured ${mixpanelEvents.length} Mixpanel events`);

    const viewMacroGraphEvents = mixpanelEvents.filter(event => {
      const properties = event.properties || event.$properties || {};
      return event.event === 'view_macro' && properties.event_category === 'graph';
    });

    console.log(`\nFound ${viewMacroGraphEvents.length} view_macro events with event_category=graph`);

    if (viewMacroGraphEvents.length > 0) {
      console.log('\n✅ view_macro tracking verified!');
      console.log('Event details:', JSON.stringify(viewMacroGraphEvents[0], null, 2));
    }

    // Assert that we captured at least one view_macro event for graph
    expect(viewMacroGraphEvents.length).toBeGreaterThan(0);
  });
});
