export interface EventDateTime {
  date_time?: string;
  date?: string;
  time_zone?: string;
}

export interface EventRepetitionWeekly {
  week_days: string[];
}

export interface EventRepetition {
  freq: string;
  interval: number;
  weekly?: EventRepetitionWeekly;
}

export type EventUserRelationType =
  | 'ORGANIZER'
  | 'ATTENDEE'
  | 'OPTIONAL_ATTENDEE'
  | 'SUBSCRIBER'
  | 'NONE';

export interface EventRules {
  visibility: string;
  participant_can_invite: boolean;
  participant_can_edit: boolean;
}

export interface CalendarEvent {
  ical_uid: string;
  event_id: string;
  recurrence_id?: string;
  start: EventDateTime;
  end: EventDateTime;
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  sequence?: number;
  created_at: string;
  updated_at: string;
  relation_type: EventUserRelationType | string;
  rules: EventRules;
  repetition?: EventRepetition;
}

export interface PaginatedResponse<T> {
  limit?: number;
  items: T[];
  iteration_key?: string;
}

export type GetEventsResponse = PaginatedResponse<CalendarEvent>;

export interface UserToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export type ParticipantDecision = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS_ACTION';
export type ParticipationType = 'ATTENDEE' | 'OPTIONAL';

export interface Participant {
  participation_id: string;
  participation_type: ParticipationType | string;
  email: string;
  decision: ParticipantDecision;
  created_at: string;
  updated_at: string;
}

export type GetParticipantsResponse = PaginatedResponse<Participant>;
