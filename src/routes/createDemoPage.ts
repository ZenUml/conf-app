import { createApp } from 'vue';
import CreateDemoPage from '@/components/Admin/CreateDemoPage.vue';

export async function handleCreateDemoPageRoute() {
  const app = createApp(CreateDemoPage);
  const container = document.getElementById('app');
  if (container) {
    app.mount(container);
  } else {
    console.error('App container not found for createDemoPage route');
  }
}
