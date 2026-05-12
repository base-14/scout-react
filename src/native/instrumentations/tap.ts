import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
export function installNativeTapTracker(scout: Scout): () => void {
    if (!RN?.Pressable)
        return () => { };
    const wrapHandler = (originalHandler: any, label: string) => (event: any) => {
        try {
            scout.emitSpan(SPAN.USER_INTERACTION, {
                [ATTR.USER_INTERACTION_TYPE]: 'click',
                [ATTR.USER_INTERACTION_TARGET]: label,
                [ATTR.USER_INTERACTION_TARGET_TYPE]: 'Pressable',
                ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(BREADCRUMB_TYPE.TAP, `Pressable: ${label}`);
        }
        catch {
        }
        return originalHandler?.(event);
    };
    const origRender = RN.Pressable.render?.bind(RN.Pressable);
    if (!origRender)
        return () => { };
    RN.Pressable.render = function (props: any, ref: any) {
        const label = props.accessibilityLabel ??
            (typeof props.children === 'string' ? props.children : 'pressable');
        const next = {
            ...props,
            onPress: props.onPress ? wrapHandler(props.onPress, label) : props.onPress,
        };
        return origRender(next, ref);
    };
    return () => {
        RN.Pressable.render = origRender;
    };
}
