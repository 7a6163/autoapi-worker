import { sendTelegramMessage } from './index';

interface Config {
  rounds_delay: boolean;
  rounds_delay_min: number;
  rounds_delay_max: number;
  api_delay: boolean;
  api_delay_min: number;
  api_delay_max: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface WorkerEnv {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  E5_CONFIG: KVNamespace;
}

const API_LIST: readonly string[] = [
  'https://graph.microsoft.com/v1.0/me/',
  'https://graph.microsoft.com/v1.0/users',
  'https://graph.microsoft.com/v1.0/me/people',
  'https://graph.microsoft.com/v1.0/groups',
  'https://graph.microsoft.com/v1.0/me/contacts',
  'https://graph.microsoft.com/v1.0/me/drive/root',
  'https://graph.microsoft.com/v1.0/me/drive/root/children',
  'https://graph.microsoft.com/v1.0/drive/root',
  'https://graph.microsoft.com/v1.0/me/drive',
  'https://graph.microsoft.com/v1.0/me/drive/recent',
  'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe',
  'https://graph.microsoft.com/v1.0/me/calendars',
  'https://graph.microsoft.com/v1.0/me/events',
  'https://graph.microsoft.com/v1.0/sites/root',
  'https://graph.microsoft.com/v1.0/sites/root/sites',
  'https://graph.microsoft.com/v1.0/sites/root/drives',
  'https://graph.microsoft.com/v1.0/sites/root/columns',
  'https://graph.microsoft.com/v1.0/me/onenote/notebooks',
  'https://graph.microsoft.com/v1.0/me/onenote/sections',
  'https://graph.microsoft.com/v1.0/me/onenote/pages',
  'https://graph.microsoft.com/v1.0/me/messages',
  'https://graph.microsoft.com/v1.0/me/mailFolders',
  'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
  'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta',
  'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules',
  "https://graph.microsoft.com/v1.0/me/messages?$filter=importance eq 'high'",
  'https://graph.microsoft.com/v1.0/me/messages?$search="hello world"',
  'https://graph.microsoft.com/beta/me/messages?$select=internetMessageHeaders&$top'
] as const;

export async function runReadAPIs(env: WorkerEnv): Promise<void> {
  try {
    // Get access token from KV (cached from updateToken)
    let accessToken = await env.E5_CONFIG.get('ACCESS_TOKEN');
    
    // If no cached access token, get new one
    if (!accessToken) {
      const refreshToken = await env.E5_CONFIG.get('MS_TOKEN');
      if (!refreshToken) {
        throw new Error('No refresh token found');
      }
      
      const tokens = await getAccessToken(refreshToken, env.CLIENT_ID, env.CLIENT_SECRET);
      accessToken = tokens.access_token;
      
      // Cache the access token
      await env.E5_CONFIG.put('ACCESS_TOKEN', accessToken, {
        expirationTtl: 3600
      });
    }

    // Config for delays (same as original Python version)
    const config: Config = {
      rounds_delay: true,
      rounds_delay_min: 60,
      rounds_delay_max: 120,
      api_delay: true,
      api_delay_min: 2,
      api_delay_max: 6
    };

    // Randomize API selection (pick 12 from 28)
    const fixedApis: number[] = [0, 1, 5, 6, 20, 21];
    const extraApis: number[] = [2, 3, 4, 7, 8, 9, 10, 22, 23, 24, 25, 26, 27, 13, 14, 15, 16, 17, 18, 19, 11, 12];
    
    // Randomly select 6 additional APIs
    const selectedExtras: number[] = [];
    for (let i = 0; i < 6; i++) {
      const randomIndex = Math.floor(Math.random() * extraApis.length);
      selectedExtras.push(extraApis[randomIndex]);
      extraApis.splice(randomIndex, 1);
    }
    
    const finalApiList: number[] = [...fixedApis, ...selectedExtras];
    shuffleArray(finalApiList);

    // Run 3 rounds
    const rounds = 3;
    console.log(`Running ${rounds} rounds of API calls`);
    
    for (let round = 1; round <= rounds; round++) {
      console.log(`Round ${round} starting...`);
      
      // Random delay between rounds (except first round)
      if (round > 1 && config.rounds_delay) {
        const delay = randomDelay(config.rounds_delay_min, config.rounds_delay_max);
        console.log(`Waiting ${delay} seconds before round ${round}...`);
        await new Promise<void>(resolve => setTimeout(resolve, delay * 1000));
      }
      
      // Call APIs with random delays
      for (let i = 0; i < finalApiList.length; i++) {
        const apiIndex = finalApiList[i];
        
        // Random delay between API calls
        if (config.api_delay && i > 0) {
          const delay = randomDelay(config.api_delay_min, config.api_delay_max);
          await new Promise<void>(resolve => setTimeout(resolve, delay * 1000));
        }
        
        await callGraphAPI(API_LIST[apiIndex], accessToken, i + 1, apiIndex);
      }
    }

    console.log('Read APIs completed successfully');
    await sendTelegramMessage(env, '✅ AutoApi 成功執行查詢型 API');
    
  } catch (error) {
    console.error('Read APIs failed:', error);
    await sendTelegramMessage(env, '❌ AutoApi 執行查詢型 API 失敗');
    throw error;
  }
}

async function callGraphAPI(
  url: string, 
  accessToken: string, 
  sequence: number, 
  apiNumber: number
): Promise<void> {
  const headers: HeadersInit = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  for (let retry = 0; retry < 4; retry++) {
    try {
      const response = await fetch(url, { headers });
      
      if (response.ok) {
        console.log(`    ${sequence}：第 ${apiNumber} 號 API 呼叫成功`);
        return;
      }
      
      if (retry === 3) {
        console.log(`    ${sequence}：第 ${apiNumber} 號 API 呼叫失敗`);
      }
    } catch (error) {
      if (retry === 3) {
        console.log(`    ${sequence}：第 ${apiNumber} 號 API 呼叫錯誤`);
      }
    }
    
    // Wait before retry
    if (retry < 3) {
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function getAccessToken(
  refreshToken: string, 
  clientId: string, 
  clientSecret: string
): Promise<TokenResponse> {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: 'https://login.microsoftonline.com/common/oauth2/nativeclient'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error('Failed to get access token');
  }

  return await response.json() as TokenResponse;
}

function shuffleArray(array: number[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}