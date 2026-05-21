export type AttributeValue = string | number | boolean | Array<string | number | boolean>;
export type Attributes = Record<string, AttributeValue>;
export type EventType = 'span' | 'metric' | 'log';
export type SeverityText = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export interface BeforeSendEvent {
  type: EventType;
  name: string;
  severity?: SeverityText;
  message?: string;
  [key: string]: unknown;
}
export type BeforeSendCallback = (event: BeforeSendEvent) => BeforeSendEvent | null;
export interface Breadcrumb {
  type: string;
  message: string;
  time: string;
}
export type Platform = 'web' | 'react-native';
