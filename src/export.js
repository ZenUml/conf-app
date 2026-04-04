
import api, { route } from '@forge/api';

// Export function for Forge macros to support Word export
export const handler = async (payload) => {
  try {
    // The "extensionPayload" field is observed since 2025-09-20
    const customContentId = payload.context.config?.customContentId 
      || payload.extensionPayload?.config?.customContentId;
    
    // context.content?.id for PDF, context.contentId for Word
    const pageId = payload.context.content?.id || payload.context.contentId;

    if (!customContentId) {
      console.warn(`Export: no customContentId, page ${pageId}`);
      return createErrorDocument("Diagram content not available for export");
    }

    const attachmentName = `zenuml-${customContentId}.png`;
    
    const response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Export: attachments API ${response.status} for ${attachmentName} on page ${pageId}`, errorBody);
      return createErrorDocument(`Failed to fetch attachments: ${response.status}`);
    }
    
    const attachmentsData = await response.json();
    
    if (!attachmentsData?.results?.length) {
      console.debug(`Export: ${attachmentName} not found on page ${pageId}`);
      return createErrorDocument("Diagram attachment not found");
    }

    const attachment = attachmentsData.results[0];
    const downloadLink = `${attachmentsData._links.base}${attachment.downloadLink}`;
    
    console.info(`Export: found ${attachmentName} on page ${pageId}`);

    return createMediaDocument(downloadLink);
    
  } catch (error) {
    console.error('Export function error:', error);
    return createErrorDocument("Error generating export content");
  }
};

// Helper function to create error ADF document
function createErrorDocument(message) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: message
          }
        ]
      }
    ]
  };
}

// Helper function to create media ADF document
function createMediaDocument(downloadLink) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        "type": "mediaSingle",
        "attrs": {
          "layout": "center"
        },
        "content": [
          {
            "type": "media",
            "attrs": {
              "type": "external",
              "url": downloadLink
            }
          }
        ]
      }
    ]
  };
}