import { getPrisma } from './prisma-lambda';
import { searchNotion, queryNotionDatabase, getNotionPageBlocks, extractPlainText } from './notion-http';

/**
 * Get Notion access token for a user
 */
export async function getNotionToken(userId: string): Promise<string | null> {
  const prisma = await getPrisma();
  
  try {
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'notion',
      },
    });
    
    if (!account || !account.access_token) {
      return null;
    }
    
    return account.access_token;
  } catch (error) {
    console.error('Error getting Notion token:', error);
    return null;
  }
}

/**
 * Check if user has Notion connected
 */
export async function hasNotionIntegration(userId: string): Promise<boolean> {
  const prisma = await getPrisma();
  
  const integration = await prisma.integration.findFirst({
    where: {
      userId,
      provider: 'notion',
      status: 'connected',
    },
  });
  
  return !!integration;
}

export type NotionSnippet = {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
  summary: string;
  type: 'page' | 'database';
  sourceRef: { provider: 'notion'; id: string };
};

/**
 * Fetch recent Notion pages for user
 */
export async function fetchRecentNotionPages(
  userId: string,
  sinceDate?: Date,
  maxResults = 10
): Promise<NotionSnippet[]> {
  const token = await getNotionToken(userId);
  if (!token) {
    return [];
  }
  
  try {
    const results = await searchNotion(
      token,
      undefined,
      { value: 'page' },
      maxResults
    );
    
    const snippets: NotionSnippet[] = [];
    
    for (const item of results.results) {
      if (!('object' in item) || item.object !== 'page') continue;
      
      const titleProp = (item as any).properties?.title || (item as any).properties?.Name;
      const title = titleProp?.title ? extractPlainText(titleProp.title) : 'Untitled';
      
      if (sinceDate && new Date(item.last_edited_time) < sinceDate) {
        continue;
      }
      
      snippets.push({
        id: item.id,
        title,
        url: item.url,
        lastEdited: item.last_edited_time,
        summary: '',
        type: 'page',
        sourceRef: { provider: 'notion', id: item.id },
      });
    }
    
    return snippets;
  } catch (error) {
    console.error('Error fetching Notion pages:', error);
    return [];
  }
}

/**
 * Search Notion for query
 */
export async function searchNotionContent(
  userId: string,
  query: string,
  maxResults = 10
): Promise<NotionSnippet[]> {
  const token = await getNotionToken(userId);
  if (!token) {
    return [];
  }
  
  try {
    const results = await searchNotion(token, query, undefined, maxResults);
    
    const snippets: NotionSnippet[] = [];
    
    for (const item of results.results) {
      const isPage = ('object' in item) && item.object === 'page';
      const title = isPage
        ? extractPlainText((item as any).properties?.title?.title || [])
        : extractPlainText((item as any).title || []);

      snippets.push({
        id: item.id,
        title: title || 'Untitled',
        url: item.url,
        lastEdited: item.last_edited_time || (isPage ? (item as any).created_time : undefined),
        summary: '',
        type: isPage ? 'page' : 'database',
        sourceRef: { provider: 'notion', id: item.id },
      });
    }
    
    return snippets;
  } catch (error) {
    console.error('Error searching Notion:', error);
    return [];
  }
}
