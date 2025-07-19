import { FullConfig } from '@playwright/test';
import fs from 'fs';

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Starting global teardown...');
  
  // Clean up authentication state file
  if (fs.existsSync('auth-state.json')) {
    fs.unlinkSync('auth-state.json');
    console.log('✅ Cleaned up authentication state');
  }
  
  console.log('✅ Global teardown complete!');
}

export default globalTeardown;