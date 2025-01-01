const typeMap = {
  'sequence': 'sequence',
  'mermaid': 'flow',
  'flow': 'mermaid',
}

export async function generateDsl(context, title, content, diagramId, diagramType = 'sequence') {
  const baseUrl = context.env.DIAGRAMLY_BACKEND_API_BASE_URL;
  console.log('Diagram API base URL:', baseUrl, ', api key:', context.env.DIAGRAMLY_API_KEY, ', diagramId:', diagramId);

  const diagramCommandMap = {
    'sequence': `Draw a sequence diagram for this Confluence page whose title is "${title}", and content is:\n\n${content}`,
    'mermaid': `Draw a Mermaid flow chart for this Confluence page whose title is "${title}", and content is:\n\n${content}`,
  };

  const diagramData = {
    0: {
      json: {
        imageUrl: "",
        imageName: "",
        diagramType: typeMap[diagramType],
        diagramId,
        command: diagramCommandMap[diagramType],
        overridePrompt: false,
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
    // console.log('Diagram API response:', JSON.stringify(diagramResult));

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