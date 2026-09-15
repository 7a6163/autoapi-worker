export interface WorkerEnv {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  E5_CONFIG: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  CHAT_ID?: string;
}

export interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
