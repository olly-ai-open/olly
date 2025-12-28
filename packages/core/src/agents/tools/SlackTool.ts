import { z } from 'zod';
import { BaseTool, ToolContext } from '../base/Tool';
import { getSlackClient } from '../../slack';
import { WebClient } from '@slack/web-api';

/**
 * Input schema for Slack operations
 */
const SlackToolInput = z.object({
  operation: z.enum(['searchMessages', 'getChannels', 'getThreadMessages', 'getUserInfo']),
  query: z.string().optional().describe('Search query for messages'),
  channelId: z.string().optional().describe('Slack channel ID'),
  threadTs: z.string().optional().describe('Thread timestamp for getting thread messages'),
  userId: z.string().optional().describe('User ID for getting user information'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  timeframe: z.object({
    startDate: z.string().optional().describe('Start date for search (ISO 8601)'),
    endDate: z.string().optional().describe('End date for search (ISO 8601)'),
  }).optional().describe('Time range for searching messages'),
});

type SlackToolInputType = z.infer<typeof SlackToolInput>;

/**
 * Slack tool for searching messages, accessing channels, and retrieving user information
 */
export class SlackTool extends BaseTool<SlackToolInputType, any> {
  name = 'slack';
  description = 'Search Slack messages, get channel information, retrieve thread messages, and get user details';
  parameters = SlackToolInput;
  
  async execute(input: SlackToolInputType, context: ToolContext): Promise<any> {
    const { operation, query, channelId, threadTs, userId, maxResults, timeframe } = input;
    
    // Get Slack client for the user
    const slackClient = await getSlackClient(context.userId);
    if (!slackClient) {
      throw new Error('Slack not connected for user');
    }
    
    switch (operation) {
      case 'searchMessages':
        if (!query) {
          throw new Error('Query required for searchMessages operation');
        }
        return this.searchMessages(slackClient, query, maxResults, timeframe);
      
      case 'getChannels':
        return this.getChannels(slackClient, maxResults);
      
      case 'getThreadMessages':
        if (!channelId || !threadTs) {
          throw new Error('Channel ID and thread timestamp required for getThreadMessages operation');
        }
        return this.getThreadMessages(slackClient, channelId, threadTs, maxResults);
      
      case 'getUserInfo':
        if (!userId) {
          throw new Error('User ID required for getUserInfo operation');
        }
        return this.getUserInfo(slackClient, userId);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private async searchMessages(
    slackClient: WebClient,
    query: string,
    maxResults?: number,
    timeframe?: { startDate?: string; endDate?: string }
  ) {
    try {
      // Build search query with timeframe if provided
      let searchQuery = query;
      if (timeframe?.startDate) {
        const startTimestamp = Math.floor(new Date(timeframe.startDate).getTime() / 1000);
        searchQuery += ` after:${startTimestamp}`;
      }
      if (timeframe?.endDate) {
        const endTimestamp = Math.floor(new Date(timeframe.endDate).getTime() / 1000);
        searchQuery += ` before:${endTimestamp}`;
      }
      
      const result = await slackClient.search.messages({
        query: searchQuery,
        count: maxResults || 10,
        sort: 'timestamp',
        sort_dir: 'desc',
      });
      
      if (!result.ok) {
        throw new Error(`Slack search failed: ${result.error}`);
      }
      
      const messages = result.messages?.matches || [];
      
      return {
        messages: messages.map(this.formatMessage),
        count: messages.length,
        query: searchQuery,
        total: result.messages?.total || 0,
      };
    } catch (error) {
      console.error('Error searching Slack messages:', error);
      throw error;
    }
  }
  
  private async getChannels(slackClient: WebClient, maxResults?: number) {
    try {
      const result = await slackClient.conversations.list({
        types: 'public_channel,private_channel,im,mpim',
        limit: maxResults || 100,
        exclude_archived: true,
      });
      
      if (!result.ok) {
        throw new Error(`Failed to get channels: ${result.error}`);
      }
      
      const channels = result.channels || [];
      
      return {
        channels: channels.map((channel: any) => ({
          id: channel.id,
          name: channel.name || channel.user || 'Direct Message',
          type: channel.is_channel ? 'channel' : channel.is_im ? 'im' : 'mpim',
          is_private: channel.is_private,
          is_member: channel.is_member,
          topic: channel.topic?.value,
          purpose: channel.purpose?.value,
          num_members: channel.num_members,
          created: channel.created,
        })),
        count: channels.length,
      };
    } catch (error) {
      console.error('Error getting Slack channels:', error);
      throw error;
    }
  }
  
  private async getThreadMessages(
    slackClient: WebClient,
    channelId: string,
    threadTs: string,
    maxResults?: number
  ) {
    try {
      const result = await slackClient.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: maxResults || 100,
      });
      
      if (!result.ok) {
        throw new Error(`Failed to get thread messages: ${result.error}`);
      }
      
      const messages = result.messages || [];
      
      return {
        messages: messages.map(this.formatMessage),
        count: messages.length,
        channelId,
        threadTs,
      };
    } catch (error) {
      console.error('Error getting thread messages:', error);
      throw error;
    }
  }
  
  private async getUserInfo(slackClient: WebClient, userId: string) {
    try {
      const result = await slackClient.users.info({
        user: userId,
      });
      
      if (!result.ok) {
        throw new Error(`Failed to get user info: ${result.error}`);
      }
      
      const user = result.user;
      if (!user) {
        throw new Error(`Failed to find user`);
      }
      
      return {
        id: user.id,
        name: user.name,
        real_name: user.real_name,
        display_name: user.profile?.display_name,
        email: user.profile?.email,
        title: user.profile?.title,
        phone: user.profile?.phone,
        status_text: user.profile?.status_text,
        status_emoji: user.profile?.status_emoji,
        is_admin: user.is_admin,
        is_owner: user.is_owner,
        is_bot: user.is_bot,
        timezone: user.tz,
        avatar: user.profile?.image_192,
      };
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }
  
  private formatMessage(message: any) {
    return {
      type: message.type,
      text: message.text,
      user: message.user || message.username,
      ts: message.ts,
      channel: message.channel?.id || message.channel,
      channel_name: message.channel?.name,
      permalink: message.permalink,
      thread_ts: message.thread_ts,
      reply_count: message.reply_count,
      reply_users_count: message.reply_users_count,
      latest_reply: message.latest_reply,
      reactions: message.reactions?.map((r: any) => ({
        name: r.name,
        count: r.count,
        users: r.users,
      })),
      attachments: message.attachments?.map((a: any) => ({
        title: a.title,
        text: a.text,
        fallback: a.fallback,
        color: a.color,
        author_name: a.author_name,
        fields: a.fields,
      })),
      files: message.files?.map((f: any) => ({
        id: f.id,
        name: f.name,
        title: f.title,
        mimetype: f.mimetype,
        size: f.size,
        url_private: f.url_private,
        permalink: f.permalink,
      })),
    };
  }
}