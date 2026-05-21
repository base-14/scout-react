import { Children, createElement, type ReactNode } from 'react';
import { ATTR } from '../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../core/spans';
import { withSuppression } from './soft-load';
import { uuidv4 } from '../core/uuid';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
interface ScoutTouchBoundaryProps {
  children: ReactNode;
}
export function ScoutTouchBoundary({ children }: ScoutTouchBoundaryProps) {
  if (!RN?.View) {
    return Children.only(children) as any;
  }
  const Scout = require('./index').Scout;
  return createElement(
    RN.View,
    {
      style: { flex: 1 },
      onStartShouldSetResponderCapture: (e: any) => {
        try {
          const target = e?._targetInst ?? e?.target;
          const { description, source } = describeTouchTarget(target);
          const typeName = inferComponentName(target);
          const ne = e?.nativeEvent;
          Scout.instance?.emitSpan(SPAN.USER_INTERACTION, {
            [ATTR.USER_INTERACTION_ID]: uuidv4(),
            [ATTR.USER_INTERACTION_TYPE]: 'tap',
            [ATTR.USER_INTERACTION_TARGET]: description,
            [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
            [ATTR.USER_INTERACTION_TARGET_NAME_SOURCE]: source,
            [ATTR.USER_INTERACTION_TARGET_PERMANENT_ID]: targetPermanentId(target),
            ...(typeof ne?.locationX === 'number'
              ? { [ATTR.USER_INTERACTION_TARGET_X]: Math.round(ne.locationX) }
              : {}),
            ...(typeof ne?.locationY === 'number'
              ? { [ATTR.USER_INTERACTION_TARGET_Y]: Math.round(ne.locationY) }
              : {}),
            ...Scout.instance.commonAttributes(),
          });
          Scout.instance?.addBreadcrumb(
            BREADCRUMB_TYPE.TAP,
            `${typeName}: ${description}`,
          );
        } catch {}
        return false;
      },
    },
    children,
  );
}
function describeTouchTarget(target: any): {
  description: string;
  source: string;
} {
  if (!target) return { description: 'unknown', source: 'blank' };
  let cur: any = target;
  let depth = 0;
  let firstStringChild: string | null = null;
  while (cur && depth < 12) {
    const props = cur.memoizedProps ?? cur.pendingProps ?? cur.stateNode?.props;
    if (props) {
      if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel) {
        return { description: props.accessibilityLabel, source: 'standard_attribute' };
      }
      if (typeof props.testID === 'string' && props.testID) {
        return { description: props.testID, source: 'standard_attribute' };
      }
      if (
        firstStringChild == null &&
        typeof props.children === 'string' &&
        props.children
      ) {
        firstStringChild = String(props.children).slice(0, 60);
      }
    }
    cur = cur.return ?? cur._return;
    depth++;
  }
  if (firstStringChild) return { description: firstStringChild, source: 'text_content' };
  const childText = findFirstChildText(target);
  if (childText) return { description: childText.slice(0, 60), source: 'text_content' };
  return { description: 'pressable', source: 'blank' };
}
function findFirstChildText(target: any): string | null {
  let depth = 0;
  const stack: any[] = [target?.child];
  while (stack.length > 0 && depth < 32) {
    const node = stack.pop();
    depth++;
    if (!node) continue;
    const props = node.memoizedProps ?? node.pendingProps;
    if (props && typeof props.children === 'string' && props.children) {
      return props.children;
    }
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  return null;
}
function targetPermanentId(target: any): string {
  try {
    const parts: string[] = [];
    let cur: any = target;
    let depth = 0;
    while (cur && depth < 8) {
      const t = cur.type;
      if (t) {
        const name = typeof t === 'string' ? t : (t.displayName ?? t.name ?? '?');
        parts.unshift(name);
      }
      cur = cur.return ?? cur._return;
      depth++;
    }
    const chain = parts.join('>');
    let h = 5381;
    for (let i = 0; i < chain.length; i++) {
      h = (h * 33) ^ chain.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  } catch {
    return '';
  }
}
function inferComponentName(target: any): string {
  if (!target) return 'unknown';
  let cur: any = target;
  let depth = 0;
  let hostName: string | null = null;
  while (cur && depth < 12) {
    const t = cur.type;
    if (t) {
      if (typeof t === 'string') {
        if (!hostName) hostName = t;
      } else {
        const name = t.displayName || t.name || t.render?.displayName || t.render?.name;
        if (name) return name;
        return 'Component';
      }
    }
    cur = cur.return ?? cur._return;
    depth++;
  }
  return hostName ?? 'unknown';
}
