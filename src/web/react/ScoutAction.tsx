import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
export interface ScoutActionProps {
  description: string;
  children: ReactNode;
}
export function ScoutAction({ description, children }: ScoutActionProps) {
  const child = Children.only(children);
  if (!isValidElement(child)) return <>{child}</>;
  const existing = (child.props as Record<string, unknown>) ?? {};
  return cloneElement(child as ReactElement<any>, {
    ...existing,
    'data-scout-action': description,
  });
}
