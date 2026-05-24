const typeMap = {
  'sequence': {diagramType: 'sequence', languageKey: 'LANG_ZENUML'},
  'mermaid': {diagramType: 'flow', languageKey: 'LANG_MERMAID', subTypeKey: "FLOWCHART"},
  'OpenAPI': {diagramType: 'openapi', languageKey: 'LANG_OPENAPI'},
  'plantuml': {diagramType: 'plantuml', languageKey: 'LANG_PLANTUML'},
}

export async function generateDsl(context, title, content, userPrompt, diagramId, diagramType = 'sequence') {
  const diagramData = {
    0: {
      json: {
        diagramType: typeMap[diagramType].diagramType,
        languageKey: typeMap[diagramType].languageKey,
        subTypeKey: typeMap[diagramType].subTypeKey,
        diagramId,
        command: getPrompt(diagramType, title, content, userPrompt),
      },
    },
  };

  const diagramResult = await callDiagramly(context, `/api/version.create?batch=1`, diagramData);

  if (diagramResult &&
      diagramResult[0]?.result?.data?.json?.gptResponse) {
    const dsl = diagramResult[0].result.data.json.gptResponse;
    const diagramId = diagramResult[0].result.data.json.diagramId;
    const diagramTitle = diagramResult[0].result.data.json.diagramTitle;
    return { dsl, diagramId, diagramTitle };
  }
}

// Asynchronous diagram modification - returns jobId for polling
export async function modifyDiagram(context, diagramCode, errorMessage, diagramType = 'sequence') {
  const typeInfo = typeMap[diagramType];

  const command = `Please resolve the issue with minimal code modifications. Preserve the original style and comments. Only address the errors; if the code lacks clarity, use the fewest words possible to improve it.`;

  const diagramData = {
    diagramCode,
    diagramType: typeInfo.diagramType,
    command,
    errorMessage,
    teamId: context.teamId,
    subTypeKey: typeInfo.subTypeKey,
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
    const teamId = context.cloudId;

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
        'x-team-id': teamId
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

const getPrompt = (diagramType, title, content, userPrompt) => {
  const para1 = content
  const para2 = userPrompt || 'the full document';

  const diagramCommandMap = {
    'sequence': `
      Please read the given Confluence page content, model the process and create the sequence diagram in ZenUML language. This diagram will be integrated into Confluence pages, so ensure it's clear and professional.

      Confluence page:

      Title: \`${title}\`

      Content:
      \`\`\`
      [${para1}]
      \`\`\`

      Key section or topic for the sequence diagram is [${para2}], ignore irrelevant content.

    `,
    'mermaid': `
      Please read the given Confluence page content, model the process and create the flow chart diagram in Mermaid language. This diagram will be integrated into Confluence pages, so ensure it's clear and professional. Mermaid language:

        Confluence page:

        Title: \`${title}\`

        Content:
        \`\`\`
        [${para1}]
        \`\`\`

        Key section or topic for the flow chart is [${para2}], ignore irrelevant content.

      `,
  };
  return diagramCommandMap[diagramType];
}
