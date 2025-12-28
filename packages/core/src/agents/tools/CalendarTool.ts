import { z } from 'zod';
import { BaseTool, ToolContext } from '../base/Tool';
import { getGoogleClient } from '../../google-http';
import { calendar_v3 } from 'googleapis';

/**
 * Input schema for calendar operations
 */
const CalendarToolInput = z.object({
  operation: z.enum(['getUpcomingMeetings', 'getMeetingDetails', 'searchMeetings']),
  timeMin: z.string().optional().describe('Start time for the query (ISO 8601)'),
  timeMax: z.string().optional().describe('End time for the query (ISO 8601)'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  query: z.string().optional().describe('Search query for meetings'),
  meetingId: z.string().optional().describe('Meeting ID for getting details'),
});

type CalendarToolInputType = z.infer<typeof CalendarToolInput>;

/**
 * Calendar tool for accessing and searching calendar events
 */
export class CalendarTool extends BaseTool<CalendarToolInputType, any> {
  name = 'calendar';
  description = 'Access Google Calendar to find meetings, get meeting details, and search for specific events';
  parameters = CalendarToolInput;
  
  async execute(input: CalendarToolInputType, context: ToolContext): Promise<any> {
    const { operation, timeMin, timeMax, maxResults, query, meetingId } = input;
    
    // Get Google client for the user
    const googleClient = await getGoogleClient(context.userId);
    if (!googleClient) {
      throw new Error('Google Calendar not connected for user');
    }
    
    const calendar = googleClient.calendar as calendar_v3.Calendar;
    
    switch (operation) {
      case 'getUpcomingMeetings':
        return this.getUpcomingMeetings(calendar, timeMin, timeMax, maxResults);
      
      case 'getMeetingDetails':
        if (!meetingId) {
          throw new Error('Meeting ID required for getMeetingDetails operation');
        }
        return this.getMeetingDetails(calendar, meetingId);
      
      case 'searchMeetings':
        if (!query) {
          throw new Error('Query required for searchMeetings operation');
        }
        return this.searchMeetings(calendar, query, timeMin, timeMax, maxResults);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private async getUpcomingMeetings(
    calendar: calendar_v3.Calendar,
    timeMin?: string,
    timeMax?: string,
    maxResults?: number
  ) {
    const now = new Date();
    const defaultTimeMin = timeMin || now.toISOString();
    const defaultTimeMax = timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ahead
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: defaultTimeMin,
      timeMax: defaultTimeMax,
      maxResults: maxResults || 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = response.data.items || [];
    
    return {
      meetings: events.map(this.formatMeeting),
      count: events.length,
      timeRange: {
        start: defaultTimeMin,
        end: defaultTimeMax,
      },
    };
  }
  
  private async getMeetingDetails(
    calendar: calendar_v3.Calendar,
    meetingId: string
  ) {
    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId: meetingId,
    });
    
    const event = response.data;
    if (!event) {
      throw new Error(`Meeting ${meetingId} not found`);
    }
    
    return {
      meeting: this.formatMeeting(event),
      raw: event,
    };
  }
  
  private async searchMeetings(
    calendar: calendar_v3.Calendar,
    query: string,
    timeMin?: string,
    timeMax?: string,
    maxResults?: number
  ) {
    const now = new Date();
    const defaultTimeMin = timeMin || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const defaultTimeMax = timeMax || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ahead
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      q: query,
      timeMin: defaultTimeMin,
      timeMax: defaultTimeMax,
      maxResults: maxResults || 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = response.data.items || [];
    
    return {
      meetings: events.map(this.formatMeeting),
      count: events.length,
      query,
      timeRange: {
        start: defaultTimeMin,
        end: defaultTimeMax,
      },
    };
  }
  
  private formatMeeting(event: calendar_v3.Schema$Event) {
    return {
      id: event.id,
      title: event.summary || 'Untitled Meeting',
      description: event.description,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      location: event.location,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName,
        responseStatus: a.responseStatus,
        organizer: a.organizer,
      })),
      organizer: event.organizer ? {
        email: event.organizer.email,
        name: event.organizer.displayName,
      } : undefined,
      meetingLink: event.hangoutLink,
      status: event.status,
      created: event.created,
      updated: event.updated,
      url: event.htmlLink,
    };
  }
}