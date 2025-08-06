import { updateToken } from './updateToken.js';
import { runReadAPIs } from './apiRead.js';
import { runWriteAPIs } from './apiWrite.js';

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    
    try {
      // Determine which task to run based on cron schedule
      if (cron === "10 10 * * 1,4,6") {
        // Update Token: Mon, Thu, Sat at 10:10 UTC
        console.log('Starting token update...');
        await updateToken(env);
        
      } else if (cron === "12 */6 * * 1-5") {
        // Read APIs: Every 6 hours on weekdays
        console.log('Starting read API calls...');
        await runReadAPIs(env);
        
      } else if (cron === "12 23 * * *") {
        // Write APIs: Daily at 23:12 UTC
        console.log('Starting write API calls...');
        await runWriteAPIs(env);
      }
      
    } catch (error) {
      console.error('Scheduled task failed:', error);
      await sendTelegramMessage(env, `❌ AutoApi Worker 執行失敗: ${error.message}`);
    }
  },

  // Manual trigger endpoint for testing
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/update-token') {
      await updateToken(env);
      return new Response('Token updated', { status: 200 });
      
    } else if (url.pathname === '/run-read') {
      await runReadAPIs(env);
      return new Response('Read APIs executed', { status: 200 });
      
    } else if (url.pathname === '/run-write') {
      await runWriteAPIs(env);
      return new Response('Write APIs executed', { status: 200 });
      
    } else {
      return new Response('AutoApi E5 Worker is running', { status: 200 });
    }
  }
};

export async function sendTelegramMessage(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.CHAT_ID) {
    console.log('Telegram config not found, skipping notification');
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: message
      })
    }
  );

  if (!response.ok) {
    console.error('Failed to send Telegram message');
  }
}