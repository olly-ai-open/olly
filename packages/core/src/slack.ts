import { WebClient } from '@slack/web-api';
import { getPrisma } from './prisma-lambda';

/**
 * Get a Slack client configured for a specific user
 * Fetches the user's Slack account tokens from the database and creates authenticated client
 */
export async function getSlackClient(userId: string): Promise<WebClient | null> {
  const prisma = await getPrisma();
  
  try {
    // Check if user has Slack integration
    const integration = await prisma.integration.findFirst({
      where: {
        userId,
        provider: 'slack',
        status: 'connected'
      }
    });
    
    if (!integration) {
      return null;
    }
    
    // Get the Slack account with tokens
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'slack'
      }
    });
    
    if (!account || !account.access_token) {
      return null;
    }
    
    // Create and return Slack WebClient
    const slackClient = new WebClient(account.access_token);
    
    return slackClient;
  } catch (error) {
    console.error('Error getting Slack client:', error);
    return null;
  }
}

/**
 * Get Slack access token for a user (for direct API calls)
 */
export async function getSlackToken(userId: string): Promise<string | null> {
  const prisma = await getPrisma();
  
  try {
    // Get the Slack account with tokens
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'slack'
      }
    });
    
    if (!account || !account.access_token) {
      return null;
    }
    
    return account.access_token;
  } catch (error) {
    console.error('Error getting Slack token:', error);
    return null;
  }
}