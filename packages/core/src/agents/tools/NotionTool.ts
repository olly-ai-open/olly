import { z } from 'zod';
import { BaseTool, ToolContext } from '../base/Tool';
import { getNotionToken } from '../../notion';
import { searchNotion, queryNotionDatabase, getNotionPageBlocks, extractPlainText, NotionPage, NotionDatabase } from '../../notion-http';

const NotionToolInput = z.object({
  operation: z.enum(['searchPages', 'searchContent', 'queryDatabase', 'getPageContent']),
  query: z.string().optional().describe('Search query for pages and content'),
  databaseId: z.string().optional().describe('Database ID to query'),
  pageId: z.string().optional().describe('Page ID to retrieve content from'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  timeframe: z.object({
    startDate: z.string().optional().describe('Start date for filtering (ISO 8601)'),
  }).optional().describe('Time range for filtering results'),
});

type NotionToolInputType = z.infer<typeof NotionToolInput>;

export class NotionTool extends BaseTool<NotionToolInputType, any> {
  name = 'notion';
  description = 'Search Notion pages, query databases, and retrieve page content';
  parameters = NotionToolInput;
  
  async execute(input: NotionToolInputType, context: ToolContext): Promise<any> {
    const { operation, query, databaseId, pageId, maxResults, timeframe } = input;

    const token = await getNotionToken(context.userId);
    if (!token) {
      throw new Error('Notion not connected for user');
    }
    
    switch (operation) {
      case 'searchPages':
        return this.searchPages(token, query, maxResults, timeframe);
      case 'searchContent':
        if (!query) {
          throw new Error('Query required for searchContent operation');
        }
        return this.searchContent(token, query, maxResults);
      case 'queryDatabase':
        if (!databaseId) {
          throw new Error('Database ID required for queryDatabase operation');
        }
        return this.queryDatabase(token, databaseId, maxResults, timeframe);
      case 'getPageContent':
        if (!pageId) {
          throw new Error('Page ID required for getPageContent operation');
        }
        return this.getPageContent(token, pageId);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private async searchPages(token: string, query?: string, maxResults?: number, timeframe?: { startDate?: string }) {
    try {
      const results = await searchNotion(token, query, { value: 'page' }, maxResults || 10);
      let pages = results.results.filter(
        (r): r is NotionPage =>
          typeof r === 'object' && 'object' in r && (r as NotionPage).object === 'page'
      );
      if (timeframe?.startDate) {
        const sinceDate = new Date(timeframe.startDate);
        pages = pages.filter(p => new Date(p.last_edited_time) >= sinceDate);
      }
      return { pages: pages.map(this.formatPage), count: pages.length, has_more: results.has_more };
    } catch (error) {
      console.error('Error searching Notion pages:', error);
      throw error;
    }
  }
  
  private async searchContent(token: string, query: string, maxResults?: number) {
    try {
      const results = await searchNotion(token, query, undefined, maxResults || 10);
      return {
        results: results.results.map(item => ({
          id: item.id,
          type: 'object' in item ? item.object : undefined,
          title: this.extractTitle(item),
          url: item.url,
          last_edited: item.last_edited_time,
        })),
        count: results.results.length,
        query,
      };
    } catch (error) {
      console.error('Error searching Notion content:', error);
      throw error;
    }
  }
  
  private async queryDatabase(token: string, databaseId: string, maxResults?: number, timeframe?: { startDate?: string }) {
    try {
      let filter;
      if (timeframe?.startDate) {
        // Timestamp filters are the only way to filter by last-edited without
        // knowing the database's property names; a `property` filter with a
        // guessed name returns HTTP 400 from Notion.
        filter = { timestamp: 'last_edited_time', last_edited_time: { on_or_after: timeframe.startDate } };
      }
      const results = await queryNotionDatabase(token, databaseId, filter, [{ timestamp: 'last_edited_time', direction: 'descending' }], maxResults || 10);
      return { items: results.results.map(this.formatPage), count: results.results.length, database_id: databaseId };
    } catch (error) {
      console.error('Error querying Notion database:', error);
      throw error;
    }
  }
  
  private async getPageContent(token: string, pageId: string) {
    try {
      const blocks = await getNotionPageBlocks(token, pageId);
      const content = blocks.results.map((block: any) => {
        const type = block.type;
        const blockContent = block[type];
        if (blockContent?.rich_text) {
          return extractPlainText(blockContent.rich_text);
        }
        return '';
      }).filter(Boolean).join('\n');
      return { page_id: pageId, content, block_count: blocks.results.length };
    } catch (error) {
      console.error('Error getting page content:', error);
      throw error;
    }
  }
  
  private formatPage(page: any) {
    const props: Record<string, any> = page.properties || {};
    // Database rows key their title under the user-chosen property name
    // (e.g. "Task"), not "title"/"Name" — fall back to the property type.
    const titleProp =
      props.title ||
      props.Name ||
      Object.values(props).find((p: any) => p?.type === 'title');
    const title = titleProp?.title ? extractPlainText(titleProp.title) : 'Untitled';

    // Surface task-style fields (status, due date, assignee, ...) so
    // database rows are usable by agents, not just a bare title.
    const fields: Record<string, string> = {};
    for (const [name, prop] of Object.entries<any>(props)) {
      if (!prop || prop.type === 'title') continue;
      let value = '';
      switch (prop.type) {
        case 'status': value = prop.status?.name ?? ''; break;
        case 'select': value = prop.select?.name ?? ''; break;
        case 'multi_select': value = (prop.multi_select || []).map((s: any) => s.name).join(', '); break;
        case 'date': value = prop.date?.start ?? ''; break;
        case 'checkbox': value = prop.checkbox ? 'checked' : 'unchecked'; break;
        case 'people': value = (prop.people || []).map((u: any) => u.name).filter(Boolean).join(', '); break;
        case 'rich_text': value = extractPlainText(prop.rich_text); break;
      }
      if (value) fields[name] = value;
    }

    return {
      id: page.id,
      title,
      url: page.url,
      last_edited: page.last_edited_time,
      created: page.created_time,
      archived: page.archived,
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  }

  private extractTitle(item: any): string {
    if ('object' in item && item.object === 'page') {
      const props: Record<string, any> = item.properties || {};
      const titleProp =
        props.title ||
        props.Name ||
        Object.values(props).find((p: any) => p?.type === 'title');
      return titleProp?.title ? extractPlainText(titleProp.title) : 'Untitled';
    } else {
      return item.title ? extractPlainText(item.title) : 'Untitled Database';
    }
  }
}
