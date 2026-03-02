import { sendTelegramMessage } from "./telegram";
import { ensureAccessToken } from "./auth";
import { shuffledCopy, pickRandom } from "./utils";
import type { WorkerEnv } from "./types";

const API_LIST: readonly string[] = [
  "https://graph.microsoft.com/v1.0/me/",
  "https://graph.microsoft.com/v1.0/users",
  "https://graph.microsoft.com/v1.0/me/people",
  "https://graph.microsoft.com/v1.0/groups",
  "https://graph.microsoft.com/v1.0/me/contacts",
  "https://graph.microsoft.com/v1.0/me/drive/root",
  "https://graph.microsoft.com/v1.0/me/drive/root/children",
  "https://graph.microsoft.com/v1.0/drive/root",
  "https://graph.microsoft.com/v1.0/me/drive",
  "https://graph.microsoft.com/v1.0/me/drive/recent",
  "https://graph.microsoft.com/v1.0/me/drive/sharedWithMe",
  "https://graph.microsoft.com/v1.0/me/calendars",
  "https://graph.microsoft.com/v1.0/me/events",
  "https://graph.microsoft.com/v1.0/sites/root",
  "https://graph.microsoft.com/v1.0/sites/root/sites",
  "https://graph.microsoft.com/v1.0/sites/root/drives",
  "https://graph.microsoft.com/v1.0/sites/root/columns",
  "https://graph.microsoft.com/v1.0/me/onenote/notebooks",
  "https://graph.microsoft.com/v1.0/me/onenote/sections",
  "https://graph.microsoft.com/v1.0/me/onenote/pages",
  "https://graph.microsoft.com/v1.0/me/messages",
  "https://graph.microsoft.com/v1.0/me/mailFolders",
  "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
  "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta",
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules",
  "https://graph.microsoft.com/v1.0/me/messages?$filter=importance eq 'high'",
  'https://graph.microsoft.com/v1.0/me/messages?$search="hello world"',
  "https://graph.microsoft.com/beta/me/messages?$select=internetMessageHeaders&$top=5",
] as const;

const FIXED_API_INDICES: readonly number[] = [0, 1, 5, 6, 20, 21];
const EXTRA_API_INDICES: readonly number[] = [
  2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 24, 25,
  26, 27,
];
const EXTRA_PICK_COUNT = 6;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export async function runReadAPIs(env: WorkerEnv): Promise<void> {
  try {
    const accessToken = await ensureAccessToken(env);

    const selectedExtras = pickRandom(EXTRA_API_INDICES, EXTRA_PICK_COUNT);
    const finalApiList = shuffledCopy([...FIXED_API_INDICES, ...selectedExtras]);

    console.log(`Calling ${finalApiList.length} APIs...`);

    let successCount = 0;
    let failCount = 0;

    for (const apiIndex of finalApiList) {
      const ok = await callGraphAPI(API_LIST[apiIndex], accessToken, apiIndex);
      if (ok) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log(
      `Read APIs completed: ${successCount} succeeded, ${failCount} failed`,
    );

    if (successCount === 0) {
      throw new Error("All API calls failed");
    }

    await sendTelegramMessage(
      env,
      `✅ AutoApi 查詢型 API (${successCount}/${finalApiList.length})`,
    );
  } catch (error) {
    console.error("Read APIs failed:", error);
    await sendTelegramMessage(env, "❌ AutoApi 執行查詢型 API 失敗");
    throw error;
  }
}

async function callGraphAPI(
  url: string,
  accessToken: string,
  apiNumber: number,
): Promise<boolean> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const response = await fetch(url, { headers });

      if (response.ok) {
        await response.body?.cancel();
        console.log(`    API ${apiNumber}: success`);
        return true;
      }

      await response.body?.cancel();

      if (retry === MAX_RETRIES - 1) {
        console.error(
          `    API ${apiNumber}: failed after ${MAX_RETRIES} attempts (status: ${response.status})`,
        );
        return false;
      }
    } catch (error) {
      if (retry === MAX_RETRIES - 1) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `    API ${apiNumber}: error after ${MAX_RETRIES} attempts: ${msg}`,
        );
        return false;
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  return false;
}
