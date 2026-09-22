import { describe, it, expect } from 'vitest';
import { isSdkOriginStack, originFrameFile } from './sdk-origin';

const VITE_CHUNK = `TypeError: this.o.at is not a function
    at e._processEntry (https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:24567)
    at https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:23980`;
const UNBUNDLED = `TypeError: x is not a function
    at LayoutShiftManager._processEntry (http://localhost:5173/node_modules/web-vitals/dist/modules/lib/LayoutShiftManager.js:25:41)
    at http://localhost:5173/node_modules/@base-14/scout-react/dist/chunk-4SBCD726.js:12:3`;
const APP_TOP_FRAME = `TypeError: Cannot read properties of undefined (reading 'id')
    at Checkout (https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200)
    at https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:100`;
const APP_ONLY = `Error: boom
    at onClick (https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200)`;
const JSC = `_processEntry@https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:24567
@https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200`;
const JSC_APP = `onClick@https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200
@https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:24567`;

describe('originFrameFile', () => {
  it('reads the file of the top frame in V8 shape', () => {
    expect(originFrameFile(VITE_CHUNK)).toBe(
      'https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js',
    );
  });
  it('reads the file of the top frame in JavaScriptCore shape', () => {
    expect(originFrameFile(JSC)).toBe(
      'https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js',
    );
  });
  it('returns null for a stack without frames', () => {
    expect(originFrameFile('Error: boom')).toBeNull();
    expect(originFrameFile(undefined)).toBeNull();
  });
});

describe('isSdkOriginStack', () => {
  it('recognises the bundler chunk named after the package', () => {
    expect(isSdkOriginStack(VITE_CHUNK)).toBe(true);
  });
  it('recognises unbundled web-vitals and scout-react files', () => {
    expect(isSdkOriginStack(UNBUNDLED)).toBe(true);
  });
  it('recognises JavaScriptCore frames', () => {
    expect(isSdkOriginStack(JSC)).toBe(true);
  });
  it('keeps an application error that merely passed through the SDK', () => {
    expect(isSdkOriginStack(APP_TOP_FRAME)).toBe(false);
    expect(isSdkOriginStack(JSC_APP)).toBe(false);
  });
  it('keeps plain application errors', () => {
    expect(isSdkOriginStack(APP_ONLY)).toBe(false);
    expect(isSdkOriginStack(undefined)).toBe(false);
  });
});
