import { z } from 'zod';
import { BaseTool, ToolContext } from '../base/Tool';
import { getGoogleClient } from '../../google-http';
import { gmail_v1 } from 'googleapis';

/**
 * Input schema for email operations
 */
const EmailToolInput = z.object({
  operation: z.enum(['search', 'getThread', 'getAttachment']),
  query: z.string().optional().describe('Gmail search query'),
  threadId: z.string().optional().describe('Email thread ID'),
  messageId: z.string().optional().describe('Email message ID'),
  attachmentId: z.string().optional().describe('Attachment ID'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
});

type EmailToolInputType = z.infer<typeof EmailToolInput>;

/**
 * Email tool for searching and retrieving Gmail messages
 */
export class EmailTool extends BaseTool<EmailToolInputType, any> {
  name = 'email';
  description = 'Search Gmail, retrieve email threads, and get email attachments';
  parameters = EmailToolInput;
  
  async execute(input: EmailToolInputType, context: ToolContext): Promise<any> {
    const { operation, query, threadId, messageId, attachmentId, maxResults } = input;
    
    // Get Google client for the user
    const googleClient = await getGoogleClient(context.userId);
    if (!googleClient) {
      throw new Error('Gmail not connected for user');
    }
    
    const gmail = googleClient.gmail as gmail_v1.Gmail;
    
    switch (operation) {
      case 'search':
        if (!query) {
          throw new Error('Query required for search operation');
        }
        return this.searchEmails(gmail, query, maxResults);
      
      case 'getThread':
        if (!threadId) {
          throw new Error('Thread ID required for getThread operation');
        }
        return this.getEmailThread(gmail, threadId);
      
      case 'getAttachment':
        if (!messageId || !attachmentId) {
          throw new Error('Message ID and Attachment ID required for getAttachment operation');
        }
        return this.getAttachment(gmail, messageId, attachmentId);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private async searchEmails(
    gmail: gmail_v1.Gmail,
    query: string,
    maxResults?: number
  ) {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxResults || 10,
    });
    
    const messages = response.data.messages || [];
    
    // Get full message details for each result
    const fullMessages = await Promise.all(
      messages.slice(0, 5).map(async (msg) => {
        if (!msg.id) return null;
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
        });
        return this.formatMessage(fullMsg.data);
      })
    );
    
    return {
      messages: fullMessages.filter(Boolean),
      count: messages.length,
      query,
    };
  }
  
  private async getEmailThread(
    gmail: gmail_v1.Gmail,
    threadId: string
  ) {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });
    
    const thread = response.data;
    const messages = (thread.messages || []).map(this.formatMessage);
    
    return {
      threadId: thread.id,
      messages,
      snippet: thread.snippet,
    };
  }
  
  private async getAttachment(
    gmail: gmail_v1.Gmail,
    messageId: string,
    attachmentId: string
  ) {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    
    const attachment = response.data;
    
    // Decode base64 data if it's text
    let content = null;
    if (attachment.data) {
      try {
        const buffer = Buffer.from(attachment.data, 'base64');
        content = buffer.toString('utf-8');
      } catch (e) {
        // Not text content, return as base64
        content = attachment.data;
      }
    }
    
    return {
      attachmentId,
      size: attachment.size,
      data: content,
    };
  }
  
  private formatMessage(message: gmail_v1.Schema$Message) {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => 
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;
    
    // Extract body
    let body = '';
    const extractBody = (part: gmail_v1.Schema$MessagePart): void => {
      if (part.body?.data) {
        try {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        } catch (e) {
          // Ignore decode errors
        }
      }
      if (part.parts) {
        part.parts.forEach(extractBody);
      }
    };
    
    if (message.payload) {
      extractBody(message.payload);
    }
    
    // Extract attachments
    const attachments: any[] = [];
    const extractAttachments = (part: gmail_v1.Schema$MessagePart): void => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        part.parts.forEach(extractAttachments);
      }
    };
    
    if (message.payload) {
      extractAttachments(message.payload);
    }
    
    return {
      id: message.id,
      threadId: message.threadId,
      subject: getHeader('subject'),
      from: getHeader('from'),
      to: getHeader('to'),
      date: getHeader('date'),
      snippet: message.snippet,
      body: body.substring(0, 1000), // Limit body size
      attachments,
      labels: message.labelIds,
      url: message.id ? `https://mail.google.com/mail/u/0/#all/${message.id}` : undefined,
    };
  }
}