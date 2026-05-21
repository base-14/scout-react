import type {
  Attributes,
  BeforeSendCallback,
  BeforeSendEvent,
  EventType,
  SeverityText,
} from './types';
export function applyBeforeSend(
  cb: BeforeSendCallback | undefined,
  type: EventType,
  name: string,
  attributes: Attributes,
  opts?: {
    severity?: SeverityText;
    message?: string;
  },
): {
  attributes: Attributes;
  severity?: SeverityText;
  message?: string;
} | null {
  if (!cb) {
    return { attributes, ...opts };
  }
  const event: BeforeSendEvent = {
    type,
    name,
    ...(opts?.severity ? { severity: opts.severity } : {}),
    ...(opts?.message ? { message: opts.message } : {}),
    ...attributes,
  };
  let result: BeforeSendEvent | null;
  try {
    result = cb(event);
  } catch {
    return { attributes, ...opts };
  }
  if (!result) return null;
  const { type: _t, name: _n, severity, message, ...rest } = result;
  return {
    attributes: rest as Attributes,
    severity: (severity as SeverityText | undefined) ?? opts?.severity,
    message: (message as string | undefined) ?? opts?.message,
  };
}
