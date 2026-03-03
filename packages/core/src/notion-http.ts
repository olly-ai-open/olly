export type NotionPage = {
  id: string;
  object: 'page';
  created_time: string;
  last_edited_time: string;
  parent: any;
  archived: boolean;
  properties: Record<string, any>;
  url: string;
};

export type NotionDatabase = {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, any>;
  parent: any;
  url: string;
  last_edited_time: string;
};

export type NotionSearchResult = {
  object: 'list';
  results: Array<NotionPage | NotionDatabase>;
  has_more: boolean;
  next_cursor: string | null;
};

/**
 * Search Notion pages and databases
 */
export async function searchNotion(
  token: string,
  query?: string,
  filter?: { property?: string; value?: 'page' | 'database' },
  pageSize = 10
): Promise<NotionSearchResult> {
  const url = 'https://api.notion.com/v1/search';
  
  const body: any = {
    page_size: pageSize,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  };
  
  if (query) {
    body.query = query;
  }
  
  if (filter) {
    body.filter = { value: filter.value, property: 'object' };
  }
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!resp.ok) {
    throw new Error(`Notion search failed: ${resp.statusText}`);
  }
  
  return await resp.json();
}

/**
 * Retrieve a Notion page by ID
 */
export async function getNotionPage(
  token: string,
  pageId: string
): Promise<NotionPage> {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  
  if (!resp.ok) {
    throw new Error(`Failed to get Notion page: ${resp.statusText}`);
  }
  
  return await resp.json();
}

/**
 * Query a Notion database
 */
export async function queryNotionDatabase(
  token: string,
  databaseId: string,
  filter?: any,
  sorts?: any[],
  pageSize = 10
): Promise<NotionSearchResult> {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  
  const body: any = {
    page_size: pageSize,
  };
  
  if (filter) {
    body.filter = filter;
  }
  
  if (sorts) {
    body.sorts = sorts;
  }
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!resp.ok) {
    throw new Error(`Failed to query Notion database: ${resp.statusText}`);
  }
  
  return await resp.json();
}

/**
 * Get page blocks/content
 */
export async function getNotionPageBlocks(
  token: string,
  blockId: string
): Promise<any> {
  const url = `https://api.notion.com/v1/blocks/${blockId}/children`;
  
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  
  if (!resp.ok) {
    throw new Error(`Failed to get page blocks: ${resp.statusText}`);
  }
  
  return await resp.json();
}

/**
 * Extract plain text from Notion rich text array
 */
export function extractPlainText(richTextArray: any[]): string {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map(rt => rt.plain_text || '').join('');
}
