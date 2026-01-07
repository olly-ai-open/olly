import { z } from 'zod';
import { BaseTool, ToolContext } from '../base/Tool';
import { getGoogleClient } from '../../google-http';
import { drive_v3 } from 'googleapis';

/**
 * Input schema for drive operations
 */
const DriveToolInput = z.object({
  operation: z.enum(['search', 'getFile', 'getFileContent']),
  query: z.string().optional().describe('Drive search query'),
  fileId: z.string().optional().describe('File ID'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  modifiedAfter: z.string().optional().describe('Modified after timestamp (ISO 8601)'),
  modifiedBefore: z.string().optional().describe('Modified before timestamp (ISO 8601)'),
});

type DriveToolInputType = z.infer<typeof DriveToolInput>;

/**
 * Drive tool for searching and retrieving Google Drive files
 */
export class DriveTool extends BaseTool<DriveToolInputType, any> {
  name = 'drive';
  description = 'Search Google Drive, get file metadata, and retrieve file content';
  parameters = DriveToolInput;
  
  async execute(input: DriveToolInputType, context: ToolContext): Promise<any> {
    const { operation, query, fileId, maxResults, modifiedAfter, modifiedBefore } = input;
    
    // Get Google client for the user
    const googleClient = await getGoogleClient(context.userId);
    if (!googleClient) {
      throw new Error('Google Drive not connected for user');
    }
    
    const drive = googleClient.drive as drive_v3.Drive;
    
    switch (operation) {
      case 'search':
        if (!query) {
          throw new Error('Query required for search operation');
        }
        return this.searchFiles(drive, query, maxResults, modifiedAfter, modifiedBefore);
      
      case 'getFile':
        if (!fileId) {
          throw new Error('File ID required for getFile operation');
        }
        return this.getFileMetadata(drive, fileId);
      
      case 'getFileContent':
        if (!fileId) {
          throw new Error('File ID required for getFileContent operation');
        }
        return this.getFileContent(drive, fileId);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private async searchFiles(
    drive: drive_v3.Drive,
    query: string,
    maxResults?: number,
    modifiedAfter?: string,
    modifiedBefore?: string
  ) {
    // Build the search query
    let driveQuery = `fullText contains '${query.replace(/'/g, "\\'")}'`;
    
    // Add filter for non-trashed files
    driveQuery += ' and trashed = false';

    if (modifiedAfter) {
      driveQuery += ` and modifiedTime > '${modifiedAfter}'`;
    }
    if (modifiedBefore) {
      driveQuery += ` and modifiedTime < '${modifiedBefore}'`;
    }
    
    const response = await drive.files.list({
      q: driveQuery,
      pageSize: maxResults || 10,
      fields: 'files(id, name, mimeType, webViewLink, modifiedTime, createdTime, size, owners, lastModifyingUser)',
      orderBy: 'modifiedTime desc',
    });
    
    const files = response.data.files || [];
    
    return {
      files: files.map(this.formatFile),
      count: files.length,
      query,
    };
  }
  
  private async getFileMetadata(
    drive: drive_v3.Drive,
    fileId: string
  ) {
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, webViewLink, modifiedTime, createdTime, size, owners, lastModifyingUser, description, parents',
    });
    
    const file = response.data;
    
    return {
      file: this.formatFile(file),
    };
  }
  
  private async getFileContent(
    drive: drive_v3.Drive,
    fileId: string
  ) {
    // First get file metadata to check the type
    const metadataResponse = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType',
    });
    
    const file = metadataResponse.data;
    let content = '';
    
    // Handle different file types
    if (file.mimeType?.includes('google-apps')) {
      // Google Docs, Sheets, Slides - export as text
      let exportMimeType = 'text/plain';
      
      if (file.mimeType.includes('spreadsheet')) {
        exportMimeType = 'text/csv';
      } else if (file.mimeType.includes('document')) {
        exportMimeType = 'text/plain';
      } else if (file.mimeType.includes('presentation')) {
        exportMimeType = 'text/plain';
      }
      
      const exportResponse = await drive.files.export({
        fileId,
        mimeType: exportMimeType,
      });
      
      content = exportResponse.data as string;
    } else if (file.mimeType?.startsWith('text/')) {
      // Text files - download directly
      const downloadResponse = await drive.files.get({
        fileId,
        alt: 'media',
      });
      
      content = downloadResponse.data as string;
    } else {
      // Other files - return metadata only
      content = `[Binary file: ${file.name} (${file.mimeType})]`;
    }
    
    return {
      file: this.formatFile(file),
      content: content.substring(0, 5000), // Limit content size
    };
  }
  
  private formatFile(file: drive_v3.Schema$File) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      size: file.size,
      owners: file.owners?.map(o => ({
        email: o.emailAddress,
        name: o.displayName,
      })),
      lastModifyingUser: file.lastModifyingUser ? {
        email: file.lastModifyingUser.emailAddress,
        name: file.lastModifyingUser.displayName,
      } : undefined,
      description: file.description,
      parents: file.parents,
    };
  }
}
