import { sendTelegramMessage } from './index';
import type { WorkerEnv } from './types';

interface TokenResponse {
  refresh_token: string;
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export async function updateToken(env: WorkerEnv): Promise<void> {
  try {
    // Get current refresh token from KV
    const currentToken = await env.E5_CONFIG.get('MS_TOKEN');
    if (!currentToken) {
      throw new Error('No refresh token found in KV storage');
    }

    // Request new token from Microsoft
    const newToken = await getMicrosoftToken(
      currentToken,
      env.CLIENT_ID,
      env.CLIENT_SECRET
    );

    // Save new token to KV
    await env.E5_CONFIG.put('MS_TOKEN', newToken.refresh_token);
    await env.E5_CONFIG.put('ACCESS_TOKEN', newToken.access_token, {
      expirationTtl: 3600 // Cache access token for 1 hour
    });

    console.log('Token updated successfully');
    await sendTelegramMessage(env, '✅ AutoApi 成功更新 token');
    
  } catch (error) {
    console.error('Token update failed:', error);
    await sendTelegramMessage(env, '❌ AutoApi 無法更新 token');
    throw error;
  }
}

async function getMicrosoftToken(
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

  let response: Response | undefined;
  for (let retry = 0; retry < 4; retry++) {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (response.ok) {
      console.log('Successfully obtained Microsoft token');
      break;
    }

    if (retry === 3) {
      throw new Error('Failed to obtain Microsoft token after 4 attempts');
    }
    
    // Wait before retry
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
  }

  if (!response || !response.ok) {
    throw new Error('Failed to obtain Microsoft token');
  }

  const data = await response.json() as TokenResponse;
  return {
    refresh_token: data.refresh_token,
    access_token: data.access_token
  };
}