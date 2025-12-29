const typeMap = {
  'sequence': {diagramType: 'sequence', languageKey: 'LANG_ZENUML'},
  'mermaid': {diagramType: 'flow', languageKey: 'LANG_MERMAID', subTypeKey: "FLOWCHART"},
}

export async function generateDsl(context, title, content, userPrompt, diagramId, diagramType = 'sequence') {
  const baseUrl = context.env.DIAGRAMLY_BACKEND_API_BASE_URL;
  console.log('Diagram API base URL:', baseUrl, ', api key:', context.env.DIAGRAMLY_API_KEY, ', diagramId:', diagramId);

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

  try {
    const userId = context.accountId;
    const teamId = context.cloudId;

    const diagramlyApiKey = context.env.DIAGRAMLY_API_KEY;
    const maskedApiKey = `${diagramlyApiKey.slice(0, 2)}...${diagramlyApiKey.slice(-2)}`;
    const requestInfo = `x-external-id: ${userId}, x-team-id: ${teamId}, x-api-key: ${maskedApiKey}`;
    console.log(`Diagram API request with ${requestInfo}`, diagramData);
    const diagramResponse = await fetch(`${baseUrl}/api/version.create?batch=1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': diagramlyApiKey,
        'x-external-id': userId,
        'x-team-id': teamId
      },
      body: JSON.stringify(diagramData)
    });
    // console.log('Diagram API response:', diagramResponse);
    if (!diagramResponse.ok) {
      throw new Error(`Diagram API request failed with status ${diagramResponse.status}, body: ${await diagramResponse.text()}`);
    }

    const diagramResult = await diagramResponse.json();
    console.log('Diagram API response:', JSON.stringify(diagramResult));

    if (diagramResult &&
        diagramResult[0]?.result?.data?.json?.gptResponse) {
      const dsl = diagramResult[0].result.data.json.gptResponse;
      const diagramId = diagramResult[0].result.data.json.diagramId;
      return { dsl, diagramId };
    }

  } catch (error) {
    console.error('Error calling diagram API:', error);
  }

}

export async function getDiagram(context, diagramId) {
  const baseUrl = context.env.DIAGRAMLY_BACKEND_API_BASE_URL;
  console.log('Diagram API base URL:', baseUrl, ', api key:', context.env.DIAGRAMLY_API_KEY);

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

  try {
    const userId = context.accountId;
    const teamId = context.cloudId;

    const diagramlyApiKey = context.env.DIAGRAMLY_API_KEY;
    const maskedApiKey = `${diagramlyApiKey.slice(0, 2)}...${diagramlyApiKey.slice(-2)}`;
    const requestInfo = `x-external-id: ${userId}, x-team-id: ${teamId}, x-api-key: ${maskedApiKey}, diagramId: ${diagramId}, input: ${JSON.stringify(input)}`;
    console.log(`Diagram API request with ${requestInfo}`);
    const diagramResponse = await fetch(`${baseUrl}/api/version.versionsById?batch=1&input=${JSON.stringify(input)}`, {
      headers: {
        'x-api-key': diagramlyApiKey,
        'x-external-id': userId,
        'x-team-id': teamId
      }});
    // console.log('Diagram API response:', diagramResponse);
    if (!diagramResponse.ok) {
      throw new Error(`Diagram API request failed with status ${diagramResponse.status}, body: ${await diagramResponse.text()}`);
    }

    const diagramResult = await diagramResponse.json();
    // console.log('Diagram API response:', JSON.stringify(diagramResult));

    if (diagramResult &&
        diagramResult[0]?.result?.data?.json?.versions && diagramResult[0]?.result?.data?.json?.versions.length) {
      const version = diagramResult[0].result.data.json.versions[diagramResult[0]?.result?.data?.json?.versions.length - 1];
      const draft = diagramResult[0].result.data.json.draft;
      const dsl = draft && draft.content?.code || version.content?.code;
      const languageType = diagramResult[0].result.data.json.diagram?.languageType;
      return { dsl, diagramId, diagramType: typeMap[languageType] };
    }
  } catch (error) {
    console.error('Error calling diagram API:', error);
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
