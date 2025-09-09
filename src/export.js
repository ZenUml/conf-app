
import api, { route } from '@forge/api';

// Export function for Forge macros to support Word export
export const handler = async (payload) => {
  console.log('Export context:', JSON.stringify(payload));

  try {
    // Get the custom content ID from the macro context
    const customContentId = payload.context.config?.customContentId;
    
    if (!customContentId) {
      console.log('No customContentId found in context');
      return createErrorDocument("Diagram content not available for export");
    }

    // Get current page id from context, context.content?.id for PDF, context.contentId for Word
    const pageId = payload.context.content?.id || payload.context.contentId;

    // Find the attachment with the specific name using Forge API
    const attachmentName = `zenuml-${customContentId}.png`;
    
    const response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);
    
    // Check if the API call was successful
    if (!response.ok) {
      const errorBody = await response.text();
      console.log(`Failed to fetch attachments: ${response.status} ${response.statusText}`);
      console.log('Response body:', errorBody);
      return createErrorDocument(`Failed to fetch attachments: ${response.status}`);
    }
    
    const attachmentsData = await response.json();
    console.log('Attachments data:', attachmentsData);
    
    if (!attachmentsData || !attachmentsData.results || attachmentsData.results.length === 0) {
      console.log(`No attachment found with name: ${attachmentName}`);
      return createErrorDocument("Diagram attachment not found");
    }

    // Get the first matching attachment (should be only one)
    const attachment = attachmentsData.results[0];
    const downloadLink = `${attachmentsData._links.base}${attachment.downloadLink}`;
    
    console.log('Found attachment:', { attachmentName, downloadLink });

    // Return ADF structure with the attachment download link
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