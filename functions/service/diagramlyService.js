const typeMap = {
  'sequence': 'sequence',
  'mermaid': 'flow',
  'flow': 'mermaid',
}

export async function generateDsl(context, title, content, userPrompt, diagramId, diagramType = 'sequence') {
  const baseUrl = context.env.DIAGRAMLY_BACKEND_API_BASE_URL;
  console.log('Diagram API base URL:', baseUrl, ', api key:', context.env.DIAGRAMLY_API_KEY, ', diagramId:', diagramId);

  const diagramData = {
    0: {
      json: {
        imageUrl: "",
        imageName: "",
        diagramType: typeMap[diagramType],
        diagramId,
        command: getPrompt(diagramType, content, userPrompt),
        overridePrompt: true,
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

const getPrompt = (diagramType, document, userPrompt) => {
  const para1 = document
  const para2 = userPrompt || 'the full document';

  const diagramCommandMap = {
    'sequence': `
      ZenUML is a code to diagram language with a DSL defined for creating sequence diagrams.

      Rule and syntax with example below:

      \`\`\`zenuml
      // Define participants, no spaces in the name
      @Type1 "Name1"
      @Type2 "Name2"

      // Async Message from Name1 to Name2
      "Name1" -> "Name2":messageText



      // Sync Message from Name1 to Name2, no Spaces in messageText
      "Name1" -> "Name2"."messageText"(){
        // interactions between Sync Messages with activation bar
      }

      // Return Message use @return keyword, from Name2 to Name1
      @return "Name2"->"Name1": messageText

      // If, use if("condition") with {}, optional use else {}
      if("condition"){
        // scope of a activation bar
        // any interactions between
      }

      // Loop, for repeated tasks, use loop(condition) keyword with {}
      loop("condition") {
        // in scope interactions
      }
      // optional
      else {
        // in scope else interactions
      }

      // Optional use opt keyword with {}, no ("conditon") here
      opt{
        // in scope interactions
      }

      // parallel interactions, use par keyword with {}
      par{
        // in scope interactions
      }

      // coloring, add (StandardCSSColorName) in comment line before any message
      e.g:
      // (red) some comment
      "Name1" -> "Name2":messageText
      \`\`\`

      Please you read the full documentation, find the key workflow and interactions, model the process and create the sequence diagram in it with ZenUML language follow below rules:

      - a solid line with a [solid arrowhead] means Sync Message
      - a solid line with a [lined arrowhead] means Sync Message
      - [a dashed line with a lined arrowhead] means Return Message, use @return
      - read very carefully regarding the differences between types of messages, this is the key of diagraming
      - if unknown scope keyword, always use opt
      - replace all [-->] or [->>] or [<-] with [->]
      - No spaces in any message names


      Documentation as:

      \`\`\`
      [${para1}]
      \`\`\`

      Key section or topic for the sequence diagram is [${para2}], ignore irrelevant content. 

      Now create your diagram output in below json format:

      \`\`\`json
      {
        diagram_title: "",
        diagram_content: \`ZenUML DSL\`
      }
      \`\`\`
    `,
    'mermaid': `
      Please read the full documentation, find the key workflow and interactions, model the process and create the flow chart in it with Mermaid language:

        Documentation as:
        \`\`\`
        [${para1}]
        \`\`\`

        Key section or topic for the flow chart is [${para2}], ignore irrelevant content. 

        Now create your diagram output in below json format:

        \`\`\`json
        {
          diagram_title: "",
          diagram_content: "ZenUML DSL" 
        }
        \`\`\`
      `,
  };
  return diagramCommandMap[diagramType];
}
