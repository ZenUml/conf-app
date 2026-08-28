const typeMap = {
  'sequence': {diagramType: 'sequence', languageKey: 'LANG_ZENUML', subTypeKey: 'GENERAL'},
  'mermaid': {diagramType: 'flow', languageKey: 'LANG_MERMAID', subTypeKey: "FLOWCHART"},
  'OpenAPI': {diagramType: 'openapi', languageKey: 'LANG_OPENAPI', subTypeKey: 'GENERAL'},
  'openapi': {diagramType: 'openapi', languageKey: 'LANG_OPENAPI', subTypeKey: 'GENERAL'},
  'plantuml': {diagramType: 'plantuml', languageKey: 'LANG_PLANTUML', subTypeKey: 'GENERAL'},
}

function getTypeInfo(diagramType = 'sequence') {
  const typeInfo = typeMap[diagramType];
  if (!typeInfo) {
    throw new Error(`Unsupported diagram type for AI Chat: ${diagramType}`);
  }
  return typeInfo;
}

// Asynchronous diagram modification - returns jobId for polling
export async function modifyDiagram(
  context,
  diagramCode,
  errorMessage,
  diagramType = 'sequence',
  options = {},
) {
  const typeInfo = getTypeInfo(diagramType);

  const command = `Please resolve the issue with minimal code modifications. Preserve the original style and comments. Only address the errors; if the code lacks clarity, use the fewest words possible to improve it.`;

  const diagramData = {
    diagramCode,
    diagramType: typeInfo.diagramType,
    languageKey: typeInfo.languageKey,
    command,
    errorMessage,
    subTypeKey: typeInfo.subTypeKey,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.disableReasoning !== undefined
      ? { disableReasoning: options.disableReasoning }
      : {}),
  };

  const result = await callDiagramly(context, `/api/chat/modify-async`, diagramData);

  const jobId = result?.jobId || result?.data?.jobId || result?.id;

  if (!jobId) {
    console.error('[modifyDiagram] No jobId found in response:', result);
    throw new Error('No jobId returned from Diagramly API');
  }

  return { jobId };
}

export async function chat(context, messages) {
  const response = await callDiagramly(context, `/api/chat/messages`, {messages});

  return { messages: response.messages };
}

export async function ensureDiagramlyDiagram(
  context,
  diagramCode,
  diagramType = 'sequence',
  title,
  diagramId,
) {
  const typeInfo = getTypeInfo(diagramType);
  const result = await callDiagramly(context, '/api/chat/ensure-diagram', {
    ...(diagramId ? { diagramId } : {}),
    ...(diagramCode ? { diagramCode } : {}),
    ...(title ? { title } : {}),
    languageKey: typeInfo.languageKey,
    subTypeKey: typeInfo.subTypeKey,
  });

  if (!result?.diagramId) {
    throw new Error('No diagramId returned from Diagramly API');
  }

  return result;
}

export async function getDiagram(context, diagramId) {
  const input = {
    "0": {
      "json": {
        "diagramId": diagramId,
      },
      "meta": {
        "values": {
          "id": ["undefined"]
        }
      }
    }
  };

  const diagramResult = await callDiagramly(context,`/api/version.versionsById?batch=1&input=${JSON.stringify(input)}`);

  if (diagramResult &&
      diagramResult[0]?.result?.data?.json?.versions && diagramResult[0]?.result?.data?.json?.versions.length) {
    const version = diagramResult[0].result.data.json.versions[diagramResult[0]?.result?.data?.json?.versions.length - 1];
    const draft = diagramResult[0].result.data.json.draft;
    const dsl = draft && draft.content?.code || version.content?.code;
    const languageType = diagramResult[0].result.data.json.diagram?.languageType;
    return { dsl, diagramId, diagramType: typeMap[languageType] };
  }
}

export async function callDiagramly(context, uri, payload) {
  const baseUrl = context.env.DIAGRAMLY_BACKEND_API_BASE_URL;
  const url = `${baseUrl}${uri}`;

  try {
    const userId = context.accountId;
    const cloudId = context.cloudId;
    if (typeof cloudId !== 'string' || !cloudId.trim()) {
      throw new Error('Missing cloudId in Diagramly request context');
    }

    const diagramlyApiKey = context.env.DIAGRAMLY_API_KEY;
    if(!diagramlyApiKey) {
      throw new Error('Diagramly API key is not configured');
    }

    const diagramResponse = await fetch(url, {
      method: payload ? 'POST' : 'GET',
      headers: {
        'Content-Type': payload ? 'application/json' : undefined,
        'x-api-key': diagramlyApiKey,
        'x-external-id': userId,
        'x-team-id': cloudId
      },
      body: payload ? JSON.stringify(payload) : undefined
    });

    if (!diagramResponse.ok) {
      const errorBody = await diagramResponse.text();
      console.error('[callDiagramly] API error:', diagramResponse.status, '-', errorBody);
      throw new Error(`Diagramly API request failed with status ${diagramResponse.status}, body: ${errorBody}`);
    }

    const responseText = await diagramResponse.text();

    let diagramResult;
    try {
      diagramResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[callDiagramly] Failed to parse JSON:', parseError);
      throw new Error(`Failed to parse Diagramly API response as JSON: ${responseText.substring(0, 200)}`);
    }

    return diagramResult;

  } catch (error) {
    console.error('[callDiagramly] Error:', error.message);
    throw error;
  }
}
