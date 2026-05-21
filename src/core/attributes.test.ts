import { describe, expect, it } from 'vitest';
import { ATTR } from './attributes';
import { SPAN, BREADCRUMB_TYPE } from './spans';
import { METRIC } from './metrics';
describe('attribute / span / metric name contract', () => {
  it('keeps semantic attribute keys stable', () => {
    expect(ATTR.SESSION_ID).toBe('session.id');
    expect(ATTR.ENDUSER_ID).toBe('enduser.id');
    expect(ATTR.SCREEN_NAME).toBe('screen.name');
    expect(ATTR.HTTP_METHOD).toBe('http.method');
    expect(ATTR.HTTP_URL).toBe('http.url');
    expect(ATTR.HTTP_STATUS_CODE).toBe('http.status_code');
    expect(ATTR.HTTP_DURATION_MS).toBe('http.duration_ms');
    expect(ATTR.ERROR_TYPE).toBe('error.type');
    expect(ATTR.ERROR_MESSAGE).toBe('error.message');
    expect(ATTR.ERROR_STACK_TRACE).toBe('error.stack_trace');
    expect(ATTR.ERROR_HANDLED).toBe('error.handled');
    expect(ATTR.BREADCRUMBS).toBe('breadcrumbs');
    expect(ATTR.USER_INTERACTION_TYPE).toBe('user_interaction.type');
    expect(ATTR.USER_INTERACTION_TARGET).toBe('user_interaction.target');
    expect(ATTR.APP_STARTUP_TYPE).toBe('app_startup.type');
    expect(ATTR.APP_STARTUP_DURATION).toBe('app_startup.duration');
    expect(ATTR.LONG_TASK_DURATION).toBe('long_task.duration');
    expect(ATTR.ANR_DURATION).toBe('anr.duration');
    expect(ATTR.DEVICE_BATTERY_LEVEL).toBe('device.battery.level');
    expect(ATTR.DEVICE_BATTERY_STATE).toBe('device.battery.state');
    expect(ATTR.NETWORK_CONNECTION_TYPE).toBe('network.connection.type');
  });
  it('keeps span names stable', () => {
    expect(SPAN.USER_INTERACTION).toBe('user_interaction');
    expect(SPAN.SCREEN_VIEW).toBe('screen_view');
    expect(SPAN.SCREEN_LOAD).toBe('screen_load');
    expect(SPAN.VIEW_SESSION).toBe('view_session');
    expect(SPAN.APP_STARTUP).toBe('app_startup');
    expect(SPAN.APP_PAUSED).toBe('app_paused');
    expect(SPAN.APP_RESUMED).toBe('app_resumed');
    expect(SPAN.APP_CRASH).toBe('app_crash');
    expect(SPAN.ERROR).toBe('error');
    expect(SPAN.LONG_TASK).toBe('long_task');
    expect(SPAN.FROZEN_FRAME).toBe('frozen_frame');
    expect(SPAN.ANR).toBe('anr');
    expect(SPAN.HTTP_REQUEST).toBe('http.request');
  });
  it('keeps the breadcrumb type tags parity', () => {
    expect(BREADCRUMB_TYPE.TAP).toBe('tap');
    expect(BREADCRUMB_TYPE.NAVIGATION).toBe('navigation');
    expect(BREADCRUMB_TYPE.LIFECYCLE).toBe('lifecycle');
    expect(BREADCRUMB_TYPE.ERROR).toBe('error');
    expect(BREADCRUMB_TYPE.HTTP).toBe('http');
  });
  it('uses the standard error.count metric name', () => {
    expect(METRIC.ERROR_COUNT).toBe('error.count');
  });
});
