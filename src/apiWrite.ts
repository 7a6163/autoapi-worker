import { sendTelegramMessage } from './index';
import * as XLSX from 'xlsx';
import type { WorkerEnv } from './types';

interface Config {
  app_delay: boolean;
  app_delay_min: number;
  app_delay_max: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface TableData {
  id: string;
  name?: string;
}

interface TeamData {
  id: string;
  displayName: string;
}

interface TeamsResponse {
  value: TeamData[];
}

interface ListData {
  id: string;
  displayName: string;
}

interface TaskData {
  id: string;
  title: string;
}

interface NotebookData {
  id: string;
  displayName: string;
}

interface ChannelData {
  id: string;
  displayName: string;
}

export async function runWriteAPIs(env: WorkerEnv): Promise<void> {
  try {
    // Get access token
    let accessToken = await env.E5_CONFIG.get('ACCESS_TOKEN');

    if (!accessToken) {
      const refreshToken = await env.E5_CONFIG.get('MS_TOKEN');
      if (!refreshToken) {
        throw new Error('No refresh token found');
      }
      
      const tokens = await getAccessToken(refreshToken, env.CLIENT_ID, env.CLIENT_SECRET);
      accessToken = tokens.access_token;

      await env.E5_CONFIG.put('ACCESS_TOKEN', accessToken, {
        expirationTtl: 3600
      });
    }

    // Config for delays (similar to original Python version)
    const config: Config = {
      app_delay: true,
      app_delay_min: 2,
      app_delay_max: 8
    };

    // Generate random filename
    const filename = `QAQ${Math.floor(Math.random() * 600)}.xlsx`;

    // Create Excel file using manual XLSX generation
    console.log('Creating Excel file...');
    const excelBuffer = await createExcelFile();

    // Upload to OneDrive
    console.log('Uploading file to OneDrive...');
    await uploadToOneDrive(filename, excelBuffer, accessToken);

    // Randomly select 2 operations from 4 options
    const operations: number[] = [1, 2, 3, 4];
    const selectedOps: number[] = [];
    for (let i = 0; i < 2; i++) {
      const randomIndex = Math.floor(Math.random() * operations.length);
      selectedOps.push(operations[randomIndex]);
      operations.splice(randomIndex, 1);
    }

    for (let i = 0; i < selectedOps.length; i++) {
      const op = selectedOps[i];

      // Random delay between operations
      if (config.app_delay && i > 0) {
        const delay = randomDelay(config.app_delay_min, config.app_delay_max);
        console.log(`Waiting ${delay} seconds before next operation...`);
        await new Promise<void>(resolve => setTimeout(resolve, delay * 1000));
      }

      switch (op) {
        case 1:
          console.log('Excel file operation...');
          await modifyExcelFile(filename, accessToken);
          break;
        case 2:
          console.log('Teams operation...');
          await createAndDeleteTeam(accessToken);
          break;
        case 3:
          console.log('Tasks operation...');
          await createAndDeleteTask(accessToken);
          break;
        case 4:
          console.log('OneNote operation...');
          await createAndDeleteNotebook(accessToken);
          break;
      }
    }

    console.log('Write APIs completed successfully');
    await sendTelegramMessage(env, '✅ AutoApi 成功執行寫入型 API');

  } catch (error) {
    console.error('Write APIs failed:', error);
    await sendTelegramMessage(env, '❌ AutoApi 執行寫入型 API 失敗');
    throw error;
  }
}

async function createExcelFile(): Promise<Buffer> {
  // Create workbook using SheetJS
  const workbook = XLSX.utils.book_new();

  // Generate random data
  const data: number[][] = [];
  for (let row = 0; row < 4; row++) {
    const rowData: number[] = [];
    for (let col = 0; col < 4; col++) {
      rowData.push(Math.floor(Math.random() * 600));
    }
    data.push(rowData);
  }

  // Create worksheet from data
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  // Generate XLSX buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return buffer as Buffer;
}

async function uploadToOneDrive(filename: string, buffer: Buffer, accessToken: string): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/content`;

  const response = await apiRequest('PUT', url, buffer, accessToken);
  if (response.ok) {
    console.log('    File uploaded successfully');
  }
}

async function modifyExcelFile(filename: string, accessToken: string): Promise<void> {
  const sheetName = `QVQ${Math.floor(Math.random() * 600)}`;

  // Add worksheet
  console.log('    Adding worksheet');
  let url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/workbook/worksheets/add`;
  let data = { name: sheetName };
  await apiRequest('POST', url, JSON.stringify(data), accessToken);

  // Add table
  console.log('    Adding table');
  url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/workbook/worksheets/${sheetName}/tables/add`;
  data = {
    address: "A1:D8",
    hasHeaders: false
  };
  const tableResponse = await apiRequest('POST', url, JSON.stringify(data), accessToken);
  const tableData = await tableResponse.json() as TableData;

  // Add rows
  console.log('    Adding rows');
  url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/workbook/tables/${tableData.id}/rows/add`;
  const rowsValues: number[][] = [];
  for (let i = 0; i < 2; i++) {
    const row: number[] = [];
    for (let j = 0; j < 4; j++) {
      row.push(Math.floor(Math.random() * 1200));
    }
    rowsValues.push(row);
  }
  const rowData = { values: rowsValues };
  await apiRequest('POST', url, JSON.stringify(rowData), accessToken);
}

async function createAndDeleteTeam(accessToken: string): Promise<void> {
  const teamName = `QVQ${Math.floor(Math.random() * 600)}`;

  // Create team
  console.log('    Creating team');
  let url = 'https://graph.microsoft.com/v1.0/teams';
  let data = {
    "template@odata.bind": "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
    displayName: teamName,
    description: "My Sample Team's Description"
  };
  await apiRequest('POST', url, JSON.stringify(data), accessToken);

  // Wait for team creation
  await new Promise<void>(resolve => setTimeout(resolve, 5000));

  // Get team info
  console.log('    Getting team info');
  url = 'https://graph.microsoft.com/v1.0/me/joinedTeams';
  const teamsResponse = await apiRequest('GET', url, null, accessToken);
  const teamsData = await teamsResponse.json() as TeamsResponse;

  const team = teamsData.value.find(t => t.displayName === teamName);
  if (team) {
    // Create channel
    console.log('    Creating channel');
    url = `https://graph.microsoft.com/v1.0/teams/${team.id}/channels`;
    data = {
      displayName: teamName,
      description: "Channel description",
      membershipType: "standard"
    };
    const channelResponse = await apiRequest('POST', url, JSON.stringify(data), accessToken);
    const channelData = await channelResponse.json() as ChannelData;

    // Delete channel
    console.log('    Deleting channel');
    url = `https://graph.microsoft.com/v1.0/teams/${team.id}/channels/${channelData.id}`;
    await apiRequest('DELETE', url, null, accessToken);

    // Delete team
    console.log('    Deleting team');
    url = `https://graph.microsoft.com/v1.0/groups/${team.id}`;
    await apiRequest('DELETE', url, null, accessToken);
  }
}

async function createAndDeleteTask(accessToken: string): Promise<void> {
  const taskName = `QVQ${Math.floor(Math.random() * 600)}`;

  // Create task list
  console.log('    Creating task list');
  let url = 'https://graph.microsoft.com/v1.0/me/todo/lists';
  let data = { displayName: taskName };
  const listResponse = await apiRequest('POST', url, JSON.stringify(data), accessToken);
  const listData = await listResponse.json() as ListData;

  // Create task
  console.log('    Creating task');
  url = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}/tasks`;
  data = { title: taskName };
  const taskResponse = await apiRequest('POST', url, JSON.stringify(data), accessToken);
  const taskData = await taskResponse.json() as TaskData;

  // Delete task
  console.log('    Deleting task');
  url = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}/tasks/${taskData.id}`;
  await apiRequest('DELETE', url, null, accessToken);

  // Delete task list
  console.log('    Deleting task list');
  url = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}`;
  await apiRequest('DELETE', url, null, accessToken);
}

async function createAndDeleteNotebook(accessToken: string): Promise<void> {
  const notebookName = `QVQ${Math.floor(Math.random() * 600)}`;

  // Create notebook
  console.log('    Creating notebook');
  let url = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks';
  let data = { displayName: notebookName };
  const notebookResponse = await apiRequest('POST', url, JSON.stringify(data), accessToken);
  const notebookData = await notebookResponse.json() as NotebookData;

  // Create section
  console.log('    Creating section');
  url = `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebookData.id}/sections`;
  data = { displayName: notebookName };
  await apiRequest('POST', url, JSON.stringify(data), accessToken);

  // Delete notebook
  console.log('    Deleting notebook');
  url = `https://graph.microsoft.com/v1.0/me/drive/root:/Notebooks/${notebookName}`;
  await apiRequest('DELETE', url, null, accessToken);
}

async function apiRequest(
  method: string,
  url: string,
  body: string | Buffer | null,
  accessToken: string
): Promise<Response> {
  const headers: HeadersInit = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  const options: RequestInit = {
    method,
    headers
  };

  if (body && method !== 'GET') {
    options.body = body;
  }

  for (let retry = 0; retry < 4; retry++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        console.log('        Operation successful');
        return response;
      }

      if (retry === 3) {
        console.log('        Operation failed');
        throw new Error(`API request failed: ${response.status}`);
      }
    } catch (error) {
      if (retry === 3) {
        throw error;
      }
    }

    // Wait before retry
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('API request failed after all retries');
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

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}