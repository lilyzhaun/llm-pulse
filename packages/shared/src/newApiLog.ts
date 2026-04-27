export type NewApiLogType = 2 | 5 | (number & {});

export interface NewApiLogResponse {
  success: boolean;
  message: string;
  data: NewApiLogPage;
}

export interface NewApiLogPage {
  page: number;
  page_size: number;
  total: number;
  items: NewApiLogItem[];
}

export interface NewApiLogItem {
  id: number;
  user_id: number;
  created_at: number;
  type: NewApiLogType;
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  channel: number;
  channel_name: string;
  token_id: number;
  group: string;
  ip: string;
  request_id: string;
  other: string;
}

export interface NewApiLogQuery {
  p?: number;
  page_size?: number;
  type?: NewApiLogType;
  username?: string;
  model_name?: string;
  token_name?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  channel?: number;
  group?: string;
  request_id?: string;
}
