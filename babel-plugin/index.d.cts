/**
 * Babel plugin that wraps tap handlers on React Native touchables so Scout can
 * record `ui.tap` spans carrying the component name, accessibility label,
 * testID, and static text child — none of which are recoverable at runtime.
 *
 * Register it in `babel.config.js`:
 *
 * ```js
 * module.exports = {
 *   plugins: [['@base-14/scout-react/babel-plugin', { components: ['MyButton'] }]],
 * };
 * ```
 */
declare function scoutBabelPlugin(babel: {
  types: unknown;
}): scoutBabelPlugin.ScoutBabelPlugin;

declare namespace scoutBabelPlugin {
  interface Options {
    /**
     * Component names whose handlers get wrapped. Replaces (does not extend)
     * the default set: `Pressable`, `TouchableOpacity`, `TouchableHighlight`,
     * `TouchableWithoutFeedback`, `TouchableNativeFeedback`, `Button`.
     */
    components?: string[];
    /**
     * Prop names treated as tap handlers. Replaces (does not extend) the
     * default set: `onPress`, `onLongPress`.
     */
    handlers?: string[];
  }

  interface ScoutBabelPlugin {
    name: string;
    visitor: Record<string, unknown>;
  }
}

export = scoutBabelPlugin;
