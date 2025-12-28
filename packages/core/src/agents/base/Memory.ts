/**
 * Memory interface for agent state persistence
 */
export interface AgentMemory {
  shortTerm: Map<string, any>;
  longTerm: Map<string, any>;
  
  // Short-term memory operations
  setShortTerm(key: string, value: any): void;
  getShortTerm<T = any>(key: string): T | undefined;
  clearShortTerm(): void;
  
  // Long-term memory operations
  setLongTerm(key: string, value: any): void;
  getLongTerm<T = any>(key: string): T | undefined;
  clearLongTerm(): void;
  
  // Persistence operations
  save(): Promise<void>;
  load(): Promise<void>;
}

/**
 * In-memory implementation of AgentMemory
 */
export class InMemoryAgentMemory implements AgentMemory {
  shortTerm: Map<string, any> = new Map();
  longTerm: Map<string, any> = new Map();
  
  setShortTerm(key: string, value: any): void {
    this.shortTerm.set(key, value);
  }
  
  getShortTerm<T = any>(key: string): T | undefined {
    return this.shortTerm.get(key);
  }
  
  clearShortTerm(): void {
    this.shortTerm.clear();
  }
  
  setLongTerm(key: string, value: any): void {
    this.longTerm.set(key, value);
  }
  
  getLongTerm<T = any>(key: string): T | undefined {
    return this.longTerm.get(key);
  }
  
  clearLongTerm(): void {
    this.longTerm.clear();
  }
  
  async save(): Promise<void> {
    // In-memory implementation doesn't persist
    // Override in subclasses for persistent storage
  }
  
  async load(): Promise<void> {
    // In-memory implementation doesn't persist
    // Override in subclasses for persistent storage
  }
}

/**
 * User preferences stored in memory
 */
export interface UserPreferences {
  briefStyle?: 'concise' | 'detailed' | 'balanced';
  notificationPreferences?: {
    email?: boolean;
    slack?: boolean;
    webPush?: boolean;
  };
  workingHours?: {
    start: string; // e.g., "09:00"
    end: string;   // e.g., "18:00"
    timezone: string;
  };
  customPrompts?: Record<string, string>;
}

/**
 * Meeting patterns learned from user behavior
 */
export interface MeetingPatterns {
  recurringMeetings: Array<{
    pattern: string; // e.g., "Weekly Team Sync"
    frequency: 'daily' | 'weekly' | 'monthly';
    typicalDuration: number; // minutes
    commonAttendees: string[];
    preparationNeeded: boolean;
  }>;
  
  meetingTypes: Array<{
    type: string; // e.g., "1:1", "Team Sync", "Customer Call"
    averageDuration: number;
    typicalPreparationTime: number;
    briefPriority: 'high' | 'medium' | 'low';
  }>;
}