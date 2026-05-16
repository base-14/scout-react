import { ATTR } from '../../core/attributes';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
export function installNativeContextTracker(scout: Scout): () => void {
    const disposers: Array<() => void> = [];
    const RN = withSuppression(() => require('react-native'));
    const NetInfo = withSuppression(() => require('@react-native-community/netinfo'))?.default;
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    const ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
    if (NetInfo?.addEventListener) {
        try {
            const apply = (state: any) => {
                if (!state)
                    return;
                const status = state.isConnected === true
                    ? 'connected'
                    : state.isConnected === false
                        ? 'not_connected'
                        : 'maybe';
                scout.setRuntimeAttribute(ATTR.NETWORK_CONNECTIVITY_STATUS, status);
                if (state.type) {
                    scout.setRuntimeAttribute(ATTR.NETWORK_INTERFACES, String(state.type));
                }
                const eff = state.details?.cellularGeneration;
                if (eff) {
                    scout.setRuntimeAttribute(ATTR.NETWORK_EFFECTIVE_TYPE, String(eff));
                }
                if (state.details?.carrier) {
                    scout.setRuntimeAttribute(ATTR.NETWORK_CELLULAR_CARRIER_NAME, String(state.details.carrier));
                }
            };
            const unsub = NetInfo.addEventListener(apply);
            disposers.push(() => {
                try {
                    unsub();
                }
                catch {
                }
            });
            NetInfo.fetch?.()
                .then(apply)
                .catch(() => undefined);
        }
        catch {
        }
    }
    const A11y = RN?.AccessibilityInfo;
    if (A11y) {
        const collectJsA11y = async () => {
            try {
                const [sr, rm, bt, rt, ic, gs] = await Promise.all([
                    A11y.isScreenReaderEnabled?.().catch(() => null) ?? null,
                    A11y.isReduceMotionEnabled?.().catch(() => null) ?? null,
                    A11y.isBoldTextEnabled?.().catch(() => null) ?? null,
                    A11y.isReduceTransparencyEnabled?.().catch(() => null) ?? null,
                    A11y.isInvertColorsEnabled?.().catch(() => null) ?? null,
                    A11y.isGrayscaleEnabled?.().catch(() => null) ?? null,
                ]);
                if (typeof sr === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_SCREEN_READER_ENABLED, sr);
                }
                if (typeof rm === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_REDUCE_MOTION_ENABLED, rm);
                }
                if (typeof bt === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_BOLD_TEXT_ENABLED, bt);
                }
                if (typeof rt === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_REDUCE_TRANSPARENCY_ENABLED, rt);
                }
                if (typeof ic === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_INVERT_COLORS_ENABLED, ic);
                }
                if (typeof gs === 'boolean') {
                    scout.setRuntimeAttribute(ATTR.A11Y_GRAYSCALE_ENABLED, gs);
                }
            }
            catch {
            }
        };
        void collectJsA11y();
        const subs: Array<{
            remove: () => void;
        }> = [];
        const sub = (event: string, key: string) => {
            try {
                const s = A11y.addEventListener?.(event, (val: boolean) => {
                    scout.setRuntimeAttribute(key, !!val);
                });
                if (s)
                    subs.push(s);
            }
            catch {
            }
        };
        sub('screenReaderChanged', ATTR.A11Y_SCREEN_READER_ENABLED);
        sub('reduceMotionChanged', ATTR.A11Y_REDUCE_MOTION_ENABLED);
        sub('boldTextChanged', ATTR.A11Y_BOLD_TEXT_ENABLED);
        sub('reduceTransparencyChanged', ATTR.A11Y_REDUCE_TRANSPARENCY_ENABLED);
        sub('invertColorsChanged', ATTR.A11Y_INVERT_COLORS_ENABLED);
        sub('grayscaleChanged', ATTR.A11Y_GRAYSCALE_ENABLED);
        disposers.push(() => {
            for (const s of subs) {
                try {
                    s.remove();
                }
                catch {
                }
            }
        });
    }
    try {
        const fontScale: number | undefined = RN?.PixelRatio?.getFontScale?.();
        if (typeof fontScale === 'number') {
            const cat = fontScale <= 0.85
                ? 'xs'
                : fontScale <= 0.95
                    ? 'small'
                    : fontScale <= 1.05
                        ? 'medium'
                        : fontScale <= 1.15
                            ? 'large'
                            : fontScale <= 1.3
                                ? 'xl'
                                : 'xxl';
            scout.setRuntimeAttribute(ATTR.A11Y_TEXT_SIZE, cat);
        }
    }
    catch {
    }
    if (ScoutCrash?.getAccessibilitySnapshot) {
        const snap = async () => {
            try {
                const out: Record<string, unknown> | null = await ScoutCrash.getAccessibilitySnapshot();
                if (!out)
                    return;
                const mapping: Array<[
                    string,
                    string
                ]> = [
                    ['button_shapes_enabled', ATTR.A11Y_BUTTON_SHAPES_ENABLED],
                    ['increase_contrast_enabled', ATTR.A11Y_INCREASE_CONTRAST_ENABLED],
                    ['assistive_switch_enabled', ATTR.A11Y_ASSISTIVE_SWITCH_ENABLED],
                    ['assistive_touch_enabled', ATTR.A11Y_ASSISTIVE_TOUCH_ENABLED],
                    ['video_autoplay_enabled', ATTR.A11Y_VIDEO_AUTOPLAY_ENABLED],
                    ['closed_captioning_enabled', ATTR.A11Y_CLOSED_CAPTIONING_ENABLED],
                    ['mono_audio_enabled', ATTR.A11Y_MONO_AUDIO_ENABLED],
                    ['shake_to_undo_enabled', ATTR.A11Y_SHAKE_TO_UNDO_ENABLED],
                    ['reduced_animations_enabled', ATTR.A11Y_REDUCED_ANIMATIONS_ENABLED],
                    ['differentiate_without_color', ATTR.A11Y_DIFFERENTIATE_WITHOUT_COLOR],
                    ['single_app_mode_enabled', ATTR.A11Y_SINGLE_APP_MODE_ENABLED],
                    ['on_off_switch_labels_enabled', ATTR.A11Y_ON_OFF_SWITCH_LABELS_ENABLED],
                    ['speak_screen_enabled', ATTR.A11Y_SPEAK_SCREEN_ENABLED],
                    ['speak_selection_enabled', ATTR.A11Y_SPEAK_SELECTION_ENABLED],
                ];
                for (const [native, attr] of mapping) {
                    const v = (out as Record<string, unknown>)[native];
                    if (typeof v === 'boolean')
                        scout.setRuntimeAttribute(attr, v);
                }
            }
            catch {
            }
        };
        void snap();
        try {
            const sub = RN?.AppState?.addEventListener?.('change', (state: string) => {
                if (state === 'active')
                    void snap();
            });
            if (sub) {
                disposers.push(() => {
                    try {
                        sub.remove?.();
                    }
                    catch {
                    }
                });
            }
        }
        catch {
        }
    }
    return () => {
        for (const d of disposers)
            d();
    };
}
