import { sendTelegramMessage } from "./telegram.ts";
import { ensureAccessToken } from "./auth.ts";
import { pickRandom } from "./utils.ts";
import * as XLSX from "xlsx";
import type { WorkerEnv } from "./types";

interface TableData {
  id: string;
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

interface ChannelData {
  id: string;
  displayName: string;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const TEAM_CREATION_WAIT_MS = 3000;

export async function runWriteAPIs(env: WorkerEnv): Promise<void> {
  try {
    const accessToken = await ensureAccessToken(env);

    const filename = `QAQ${Math.floor(Math.random() * 600)}.xlsx`;

    console.log("Creating Excel file...");
    const excelBuffer = createExcelFile();

    console.log("Uploading file to OneDrive...");
    await uploadToOneDrive(filename, excelBuffer, accessToken);

    const allOps = [1, 2, 3] as const;
    const selectedOps = pickRandom(allOps, 2);

    try {
      for (const op of selectedOps) {
        switch (op) {
          case 1:
            console.log("Excel file operation...");
            await modifyExcelFile(filename, accessToken);
            break;
          case 2:
            console.log("Teams operation...");
            await createAndDeleteTeam(accessToken);
            break;
          case 3:
            console.log("Tasks operation...");
            await createAndDeleteTask(accessToken);
            break;
        }
      }
    } finally {
      await deleteFromOneDrive(filename, accessToken);
    }

    console.log("Write APIs completed successfully");
    await sendTelegramMessage(env, "✅ AutoApi 成功執行寫入型 API");
  } catch (error) {
    console.error("Write APIs failed:", error);
    await sendTelegramMessage(env, "❌ AutoApi 執行寫入型 API 失敗");
    throw error;
  }
}

function createExcelFile(): Uint8Array {
  const workbook = XLSX.utils.book_new();

  const data: number[][] = [];
  for (let row = 0; row < 4; row++) {
    const rowData: number[] = [];
    for (let col = 0; col < 4; col++) {
      rowData.push(Math.floor(Math.random() * 600));
    }
    data.push(rowData);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(output);
}

async function uploadToOneDrive(
  filename: string,
  data: Uint8Array,
  accessToken: string,
): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/content`;
  await apiRequest("PUT", url, data, accessToken);
  console.log("    File uploaded successfully");
}

// Best-effort: never mask the original failure when called from finally.
async function deleteFromOneDrive(
  filename: string,
  accessToken: string,
): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}`;
  try {
    await apiRequest("DELETE", url, null, accessToken);
    console.log("    File deleted successfully");
  } catch (error) {
    console.error("    File cleanup failed:", error);
  }
}

async function modifyExcelFile(
  filename: string,
  accessToken: string,
): Promise<void> {
  const sheetName = `QVQ${Math.floor(Math.random() * 600)}`;
  const basePath = `https://graph.microsoft.com/v1.0/me/drive/root:/AutoApi/App1/${filename}:/workbook`;

  console.log("    Adding worksheet");
  const addSheetUrl = `${basePath}/worksheets/add`;
  await apiRequest(
    "POST",
    addSheetUrl,
    JSON.stringify({ name: sheetName }),
    accessToken,
  );

  console.log("    Adding table");
  const addTableUrl = `${basePath}/worksheets/${sheetName}/tables/add`;
  const tableResponse = await apiRequest(
    "POST",
    addTableUrl,
    JSON.stringify({ address: "A1:D8", hasHeaders: false }),
    accessToken,
  );

  const tableData = (await tableResponse.json()) as TableData;
  if (!tableData.id) {
    throw new Error("Table creation returned no ID");
  }

  console.log("    Adding rows");
  const addRowsUrl = `${basePath}/tables/${tableData.id}/rows/add`;
  const rowsValues: number[][] = [];
  for (let i = 0; i < 2; i++) {
    const row: number[] = [];
    for (let j = 0; j < 4; j++) {
      row.push(Math.floor(Math.random() * 1200));
    }
    rowsValues.push(row);
  }
  await apiRequest(
    "POST",
    addRowsUrl,
    JSON.stringify({ values: rowsValues }),
    accessToken,
  );
}

async function createAndDeleteTeam(accessToken: string): Promise<void> {
  const teamName = `QVQ${Math.floor(Math.random() * 600)}`;

  console.log("    Creating team");
  const createTeamUrl = "https://graph.microsoft.com/v1.0/teams";
  await apiRequest(
    "POST",
    createTeamUrl,
    JSON.stringify({
      "template@odata.bind":
        "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
      displayName: teamName,
      description: "My Sample Team's Description",
    }),
    accessToken,
  );

  await new Promise<void>((resolve) =>
    setTimeout(resolve, TEAM_CREATION_WAIT_MS),
  );

  console.log("    Getting team info");
  const listTeamsUrl = "https://graph.microsoft.com/v1.0/me/joinedTeams";
  const teamsResponse = await apiRequest("GET", listTeamsUrl, null, accessToken);
  const teamsData = (await teamsResponse.json()) as TeamsResponse;

  const team = teamsData.value.find((t) => t.displayName === teamName);
  if (!team) {
    console.warn(
      `    Team "${teamName}" not found after creation, may need manual cleanup`,
    );
    return;
  }

  console.log("    Creating channel");
  const createChannelUrl = `https://graph.microsoft.com/v1.0/teams/${team.id}/channels`;
  const channelResponse = await apiRequest(
    "POST",
    createChannelUrl,
    JSON.stringify({
      displayName: teamName,
      description: "Channel description",
      membershipType: "standard",
    }),
    accessToken,
  );
  const channelData = (await channelResponse.json()) as ChannelData;

  if (!channelData.id) {
    console.warn("    Channel creation returned no ID, skipping channel delete");
  } else {
    console.log("    Deleting channel");
    const deleteChannelUrl = `https://graph.microsoft.com/v1.0/teams/${team.id}/channels/${channelData.id}`;
    await apiRequest("DELETE", deleteChannelUrl, null, accessToken);
  }

  console.log("    Deleting team");
  const deleteTeamUrl = `https://graph.microsoft.com/v1.0/groups/${team.id}`;
  await apiRequest("DELETE", deleteTeamUrl, null, accessToken);
}

async function createAndDeleteTask(accessToken: string): Promise<void> {
  const taskName = `QVQ${Math.floor(Math.random() * 600)}`;

  console.log("    Creating task list");
  const createListUrl = "https://graph.microsoft.com/v1.0/me/todo/lists";
  const listResponse = await apiRequest(
    "POST",
    createListUrl,
    JSON.stringify({ displayName: taskName }),
    accessToken,
  );
  const listData = (await listResponse.json()) as ListData;
  if (!listData.id) {
    throw new Error("Task list creation returned no ID");
  }

  console.log("    Creating task");
  const createTaskUrl = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}/tasks`;
  const taskResponse = await apiRequest(
    "POST",
    createTaskUrl,
    JSON.stringify({ title: taskName }),
    accessToken,
  );
  const taskData = (await taskResponse.json()) as TaskData;
  if (!taskData.id) {
    throw new Error("Task creation returned no ID");
  }

  console.log("    Deleting task");
  const deleteTaskUrl = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}/tasks/${taskData.id}`;
  await apiRequest("DELETE", deleteTaskUrl, null, accessToken);

  console.log("    Deleting task list");
  const deleteListUrl = `https://graph.microsoft.com/v1.0/me/todo/lists/${listData.id}`;
  await apiRequest("DELETE", deleteListUrl, null, accessToken);
}

async function apiRequest(
  method: string,
  url: string,
  body: string | Uint8Array | null,
  accessToken: string,
): Promise<Response> {
  const isBinary = body instanceof Uint8Array;
  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": isBinary ? "application/octet-stream" : "application/json",
  };

  const options: RequestInit = { method, headers };

  if (body && method !== "GET") {
    options.body = body;
  }

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        console.log("        Operation successful");
        return response;
      }

      // Consume body to release connection before retry or final throw
      await response.body?.cancel();

      if (retry === MAX_RETRIES - 1) {
        throw new Error(`API request failed: ${response.status}`);
      }
    } catch (error) {
      if (retry === MAX_RETRIES - 1) {
        throw error;
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new Error("Unreachable: retry loop exited without return or throw");
}
